import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { hashPassword, verifyPassword } from './password.js'

const dbPath = resolve(process.env.CAMPUS_FORUM_DB ?? './data/campus-forum.db')
mkdirSync(dirname(dbPath), { recursive: true })

export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const SCHEMA_VERSION = 6
const currentVersion = db.pragma('user_version', { simple: true }) as number

if (currentVersion < 2) {
  migrate()
}
if (currentVersion < 3) {
  db.exec('ALTER TABLE posts ADD COLUMN edited INTEGER NOT NULL DEFAULT 0')
}
if (currentVersion < 4) {
  db.exec(`
    ALTER TABLE users ADD COLUMN campus TEXT NOT NULL DEFAULT '知行大学';
    ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'verified';
    ALTER TABLE posts ADD COLUMN images TEXT NOT NULL DEFAULT '[]';

    CREATE TABLE user_follows (
      follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (follower_id, following_id),
      CHECK (follower_id != following_id)
    );
    CREATE INDEX idx_user_follows_following ON user_follows(following_id);

    CREATE TABLE direct_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_low_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_high_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_low_id, user_high_id),
      CHECK (user_low_id < user_high_id)
    );
    CREATE TABLE direct_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES direct_conversations(id) ON DELETE CASCADE,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_direct_messages_conversation ON direct_messages(conversation_id, id);

    CREATE TABLE verification_codes (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)
}
if (currentVersion < 5) {
  db.exec(`
    UPDATE users SET campus = '嘉兴大学' WHERE campus = '' OR campus = '知行大学';
    UPDATE users SET nickname = '嘉大圈运营', dept = '社区运营', bio = '维护社区秩序与产品规则。' WHERE username = 'admin';
    UPDATE users SET nickname = '社区安全员', dept = '社区运营', bio = '处理举报与内容安全复核。' WHERE username = 'mod';
    UPDATE users SET nickname = '嘉大同学', bio = '在嘉大圈记录我的大学生活。' WHERE username = 'demo';

    UPDATE posts SET status = 'hidden'
      WHERE user_id IN (SELECT id FROM users WHERE role IN ('teacher', 'staff')) AND status != 'deleted';
    UPDATE comments SET status = 'hidden'
      WHERE user_id IN (SELECT id FROM users WHERE role IN ('teacher', 'staff')) AND status != 'deleted';
    UPDATE users SET status = 'banned'
      WHERE role IN ('teacher', 'staff') AND username IN ('houqin', 'jiaowu', 'tushuguan', 'teacher_li');

    UPDATE boards SET name = '课程学业', description = '课程、考试、竞赛和学习方法' WHERE name = '学习交流';
    UPDATE boards SET name = '实习就业', description = '实习、求职、考研与职业经验' WHERE name = '升学就业';
    UPDATE boards SET name = '经验问答', description = '选课避坑、校园经验与新生指南' WHERE name = '学长学姐';
    UPDATE boards SET name = '闲置集市', description = '校内闲置转让与好物交换' WHERE name = '二手集市';

    UPDATE posts SET comment_count = (
      SELECT COUNT(*) FROM comments c WHERE c.post_id = posts.id AND c.status = 'visible'
    );
  `)
}
if (currentVersion < 6) {
  const knownPrivilegedAccounts = [
    ['admin', 'admin123456'],
    ['mod', 'demo123456'],
  ] as const
  const disableKnownAccounts = db.transaction(() => {
    for (const [username, password] of knownPrivilegedAccounts) {
      const row = db.prepare('SELECT id, password_hash as passwordHash FROM users WHERE username = ?').get(username) as { id: number; passwordHash: string } | undefined
      if (!row || !verifyPassword(password, row.passwordHash)) continue
      db.prepare("UPDATE users SET status = 'banned' WHERE id = ?").run(row.id)
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id)
    }
  })
  disableKnownAccounts()
}
db.pragma(`user_version = ${SCHEMA_VERSION}`)

function migrate() {
  db.exec(`
    DROP TABLE IF EXISTS audit_logs;
    DROP TABLE IF EXISTS notifications;
    DROP TABLE IF EXISTS reports;
    DROP TABLE IF EXISTS need_follows;
    DROP TABLE IF EXISTS need_updates;
    DROP TABLE IF EXISTS needs;
    DROP TABLE IF EXISTS favorites;
    DROP TABLE IF EXISTS likes;
    DROP TABLE IF EXISTS comments;
    DROP TABLE IF EXISTS posts;
    DROP TABLE IF EXISTS boards;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS users;

    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      nickname TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','teacher','staff','moderator','admin')),
      dept TEXT NOT NULL DEFAULT '',
      grade TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      verified INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT 'Hash',
      color TEXT NOT NULL DEFAULT 'mint',
      sort INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      board_id INTEGER NOT NULL REFERENCES boards(id),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      anonymous INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','pending','hidden','deleted')),
      featured INTEGER NOT NULL DEFAULT 0,
      view_count INTEGER NOT NULL DEFAULT 0,
      like_count INTEGER NOT NULL DEFAULT 0,
      comment_count INTEGER NOT NULL DEFAULT 0,
      risk_level TEXT NOT NULL DEFAULT 'low',
      risk_reasons TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_posts_board ON posts(board_id);
    CREATE INDEX idx_posts_status ON posts(status);
    CREATE INDEX idx_posts_user ON posts(user_id);

    CREATE TABLE comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      parent_id INTEGER REFERENCES comments(id),
      body TEXT NOT NULL,
      anonymous INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden','deleted')),
      like_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_comments_post ON comments(post_id);

    CREATE TABLE likes (
      user_id INTEGER NOT NULL REFERENCES users(id),
      target_type TEXT NOT NULL CHECK (target_type IN ('post','comment')),
      target_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, target_type, target_id)
    );

    CREATE TABLE favorites (
      user_id INTEGER NOT NULL REFERENCES users(id),
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, post_id)
    );

    CREATE TABLE needs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      dept TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','progress','resolved','closed')),
      anonymous INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE need_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      need_id INTEGER NOT NULL REFERENCES needs(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE need_follows (
      user_id INTEGER NOT NULL REFERENCES users(id),
      need_id INTEGER NOT NULL REFERENCES needs(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, need_id)
    );

    CREATE TABLE reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER REFERENCES users(id),
      reporter_label TEXT NOT NULL DEFAULT '',
      target_type TEXT NOT NULL CHECK (target_type IN ('post','comment')),
      target_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
      handled_by INTEGER REFERENCES users(id),
      handled_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_reports_status ON reports(status);

    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      actor_id INTEGER REFERENCES users(id),
      target_type TEXT,
      target_id INTEGER,
      content TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_notifications_user ON notifications(user_id, read);

    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_type TEXT NOT NULL DEFAULT 'user',
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)
  seed()
}

function seed() {
  const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, nickname, role, dept, grade, bio, created_at)
    VALUES (@username, @passwordHash, @nickname, @role, @dept, @grade, @bio, datetime('now', @age))
  `)
  const insertBoard = db.prepare('INSERT INTO boards (name, description, icon, color, sort) VALUES (?, ?, ?, ?, ?)')
  const insertPost = db.prepare(`
    INSERT INTO posts (user_id, board_id, title, body, tags, anonymous, status, featured, view_count, risk_level, risk_reasons, created_at, updated_at)
    VALUES (@userId, @boardId, @title, @body, @tags, @anonymous, @status, @featured, @viewCount, @riskLevel, @riskReasons, datetime('now', @age), datetime('now', @age))
  `)
  const insertComment = db.prepare(`
    INSERT INTO comments (post_id, user_id, parent_id, body, anonymous, created_at)
    VALUES (@postId, @userId, @parentId, @body, @anonymous, datetime('now', @age))
  `)
  const insertLike = db.prepare('INSERT OR IGNORE INTO likes (user_id, target_type, target_id) VALUES (?, ?, ?)')
  const insertFavorite = db.prepare('INSERT OR IGNORE INTO favorites (user_id, post_id) VALUES (?, ?)')
  const insertNeed = db.prepare(`
    INSERT INTO needs (user_id, title, body, dept, status, anonymous, created_at, updated_at)
    VALUES (@userId, @title, @body, @dept, @status, @anonymous, datetime('now', @age), datetime('now', @updatedAge))
  `)
  const insertNeedUpdate = db.prepare(`
    INSERT INTO need_updates (need_id, user_id, status, content, created_at) VALUES (?, ?, ?, ?, datetime('now', ?))
  `)
  const insertNeedFollow = db.prepare('INSERT OR IGNORE INTO need_follows (user_id, need_id) VALUES (?, ?)')
  const insertReport = db.prepare(`
    INSERT INTO reports (reporter_id, reporter_label, target_type, target_id, reason, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))
  `)
  const insertNotification = db.prepare(`
    INSERT INTO notifications (user_id, type, actor_id, target_type, target_id, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))
  `)
  const insertAudit = db.prepare(`
    INSERT INTO audit_logs (actor_type, actor, action, target_type, target_id, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))
  `)

  const run = db.transaction(() => {
    const demoPassword = hashPassword('demo123456')
    const users: Record<string, number> = {}
    const userSeeds = [
      { username: 'admin', passwordHash: hashPassword('admin123456'), nickname: '嘉大圈运营', role: 'admin', dept: '社区运营', grade: '', bio: '维护社区秩序与产品规则。', age: '-190 days' },
      { username: 'mod', passwordHash: demoPassword, nickname: '社区安全员', role: 'moderator', dept: '社区运营', grade: '', bio: '处理举报与内容安全复核。', age: '-180 days' },
      { username: 'houqin', passwordHash: demoPassword, nickname: '后勤服务中心', role: 'staff', dept: '后勤服务中心', grade: '', bio: '受理宿舍、食堂、校园设施相关诉求。', age: '-175 days' },
      { username: 'jiaowu', passwordHash: demoPassword, nickname: '教务处', role: 'staff', dept: '教务处', grade: '', bio: '受理选课、考试、教学安排相关诉求。', age: '-175 days' },
      { username: 'tushuguan', passwordHash: demoPassword, nickname: '图书馆', role: 'staff', dept: '图书馆', grade: '', bio: '受理图书馆资源与环境相关诉求。', age: '-170 days' },
      { username: 'teacher_li', passwordHash: demoPassword, nickname: '李老师', role: 'teacher', dept: '计算机学院', grade: '', bio: '教《操作系统》，欢迎同学们随时提问。', age: '-160 days' },
      { username: 'linlin', passwordHash: demoPassword, nickname: '林同学', role: 'student', dept: '计算机学院', grade: '大三', bio: '爱写代码也爱打羽毛球。', age: '-150 days' },
      { username: 'xiaoman', passwordHash: demoPassword, nickname: '小满', role: 'student', dept: '外国语学院', grade: '大一', bio: '新生报到，多多关照！', age: '-90 days' },
      { username: 'buaoye', passwordHash: demoPassword, nickname: '学长不熬夜', role: 'student', dept: '商学院', grade: '研二', bio: '分享求职与实习经验，拒绝无效内卷。', age: '-140 days' },
      { username: 'zhou', passwordHash: demoPassword, nickname: '周同学', role: 'student', dept: '机械学院', grade: '大二', bio: '', age: '-120 days' },
      { username: 'wang', passwordHash: demoPassword, nickname: '王学姐', role: 'student', dept: '新闻学院', grade: '大四', bio: '毕业倒计时，把经验都留下。', age: '-130 days' },
      { username: 'demo', passwordHash: demoPassword, nickname: '嘉大同学', role: 'student', dept: '经济学院', grade: '大二', bio: '在嘉大圈记录我的大学生活。', age: '-128 days' },
    ]
    for (const u of userSeeds) {
      const result = insertUser.run({ ...u })
      users[u.username] = Number(result.lastInsertRowid)
    }

    const boards: Record<string, number> = {}
    const boardSeeds = [
      ['课程学业', '课程、考试、竞赛和学习方法', 'BookOpen', 'coral'],
      ['校园生活', '宿舍、食堂、出行与校园服务', 'Home', 'mint'],
      ['实习就业', '实习、求职、考研与职业经验', 'TrendingUp', 'gold'],
      ['经验问答', '选课避坑、校园经验与新生指南', 'GraduationCap', 'lavender'],
      ['闲置集市', '校内闲置转让与好物交换', 'ShoppingBag', 'sky'],
      ['社团活动', '社团招新与活动组织', 'Users', 'rose'],
    ] as const
    boardSeeds.forEach(([name, description, icon, color], index) => {
      const result = insertBoard.run(name, description, icon, color, index)
      boards[name] = Number(result.lastInsertRowid)
    })

    const postSeeds = [
      { user: 'linlin', board: '课程学业', title: '有没有人一起准备下周的数据库期末？', body: '老师给的复习范围有点大，想找几位同学组个线上自习小组，互相讲讲不会的题。已经整理了一份复习清单，涵盖关系代数、范式、索引和事务四大块，欢迎一起补充。计划每晚八点半语音对题，坚持到考前。', tags: ['数据库', '期末复习'], featured: 1, viewCount: 486, age: '-26 hours' },
      { user: 'xiaoman', board: '校园生活', title: '南区宿舍热水供应时间有调整吗？', body: '最近晚上十点半之后经常没有热水，想确认一下是临时维修还是新的供应时间。已经在校园服务小程序提交过一次反馈，有同样情况的同学可以在评论区互相同步消息。', tags: ['宿舍', '校园服务'], viewCount: 322, age: '-22 hours' },
      { user: 'buaoye', board: '实习就业', title: '分享一份真实的暑期实习准备路线（含时间表）', body: '从三月开始准备到拿到 offer，中间踩了不少坑。把简历、笔试、面试和复盘过程整理成了一份时间表：三月改简历+投递，四月集中笔试，五月三轮面试，六月等结果补投。最大的教训是：不要等"准备好了"再投，边投边补才是常态。', tags: ['实习', '经验分享'], featured: 1, viewCount: 918, age: '-2 days' },
      { user: 'wang', board: '经验问答', title: '给新生的选课避坑指南（文科版）', body: '大四老学姐的血泪经验：1) 通识课先看往年评价再选，别只看名字浪漫；2) 早八连排两节的课慎选，出勤率就是绩点；3) 期末论文型课程要提前问清查重要求；4) 跨学院选课名额很紧张，开放当晚蹲点才抢得到。祝学弟学妹们绩点长虹。', tags: ['选课', '新生指南'], viewCount: 754, age: '-3 days' },
      { user: 'teacher_li', board: '课程学业', title: '《操作系统》期末答疑安排（本周三、周五晚）', body: '同学们好，期末答疑定在本周三、周五晚上 7:00-9:00，实验楼 B404。进程调度和内存管理是历年失分重点，建议带着具体题目来。不能到场的同学可以在这个帖子下留言，我会统一回复。', tags: ['操作系统', '答疑'], featured: 0, viewCount: 407, age: '-30 hours' },
      { user: 'zhou', board: '闲置集市', title: '出一辆九成新通勤自行车，毕业学长托卖', body: '车况很好，变速正常，刹车灵敏，平时就宿舍到教学楼骑。原价 680，现在 260 出，送车锁和打气筒。想看车的同学可以在评论区约时间，工作日下午都在。', tags: ['二手', '自行车'], viewCount: 189, age: '-8 hours' },
      { user: 'demo', board: '社团活动', title: '摄影社秋季纳新：不需要相机，只需要好奇心', body: '摄影社开始纳新啦！不要求有设备，手机拍照也完全欢迎。我们每两周组织一次外拍，学校承担交通费，期末还有社内影展。上学期最受欢迎的活动是夜爬拍星轨。报名方式见社团招新墙，或在评论区留言。', tags: ['社团', '纳新', '摄影'], viewCount: 268, age: '-11 hours' },
      { user: 'linlin', board: '课程学业', title: '大二下开始学后端，Java 和 Go 怎么选？', body: '目前只学过 C 和一点 Python，想在暑假系统学一门后端语言。看招聘软件 Java 岗位多但卷，Go 岗位少但新项目多。有没有学长学姐能从课程衔接和找实习两个角度给点建议？', tags: ['后端', '技术选型'], viewCount: 231, age: '-6 hours' },
      { user: 'xiaoman', board: '校园生活', title: '图书馆四楼自习区占座现象太严重了', body: '早上八点去四楼，一半座位放着书但人不在，一直到中午都没人。建议大家文明自习，也想问问图书馆有没有类似"离座超时清桌"的规则？如果有，希望能严格执行。', tags: ['图书馆', '自习'], viewCount: 356, age: '-5 hours' },
      { user: 'demo', board: '实习就业', title: '大二要不要开始准备考研？想听听过来人的想法', body: '身边已经有同学开始背单词、看数学基础课了。我的困惑是：现在开始会不会战线太长后期乏力？还是说大二先把绩点和英语基础打好，大三再全力冲刺？希望听到不同选择的真实经历。', tags: ['考研', '规划'], viewCount: 298, age: '-4 hours' },
      { user: 'wang', board: '校园生活', title: '食堂三楼新开的麻辣香锅窗口真的可以', body: '昨天试了三楼新窗口，分量实在，两个人点了 38 块钱吃到扶墙。辣度可以选微辣，不能吃辣的同学也友好。唯一缺点是高峰期排队有点长，建议错峰 11:20 前到。', tags: ['食堂', '美食'], viewCount: 412, age: '-27 hours' },
      { user: 'zhou', board: '闲置集市', title: '低价出全新考研英语资料，先到先得', body: '全新考研英语真题卷，买重复了低价出。有意向的加我微信 zk20260521 私聊，可以先转账定金帮你留着，宿舍楼下自取。', tags: ['二手', '考研资料'], status: 'pending', riskLevel: 'high', riskReasons: ['疑似诈骗话术（转账/汇款/押金 + 私下联系）', '引导添加校外联系方式'], viewCount: 0, age: '-35 minutes' },
    ]
    const postIds: number[] = []
    for (const p of postSeeds) {
      const result = insertPost.run({
        userId: users[p.user],
        boardId: boards[p.board],
        title: p.title,
        body: p.body,
        tags: JSON.stringify(p.tags),
        anonymous: 0,
        status: p.status ?? 'visible',
        featured: p.featured ?? 0,
        viewCount: p.viewCount,
        riskLevel: p.riskLevel ?? 'low',
        riskReasons: JSON.stringify(p.riskReasons ?? []),
        age: p.age,
      })
      postIds.push(Number(result.lastInsertRowid))
    }

    const commentSeeds: Array<{ post: number; user: string; body: string; age: string; parent?: number; anonymous?: number }> = [
      { post: 0, user: 'demo', body: '算我一个！范式那块我一直似懂非懂，正好一起过。', age: '-24 hours' },
      { post: 0, user: 'zhou', body: '复习清单可以共享一下吗？我们班的重点好像不太一样。', age: '-23 hours' },
      { post: 0, user: 'linlin', body: '已经放到帖子里的链接了，晚上八点半语音见。', age: '-22 hours', parent: 1 },
      { post: 0, user: 'teacher_li', body: '事务隔离级别几乎每年必考，建议结合具体调度序列练习。', age: '-20 hours' },
      { post: 1, user: 'zhou', body: '北区也是，十一点之后基本就是凉水了。', age: '-21 hours' },
      { post: 1, user: 'houqin', body: '同学你好，南区热水管道本周检修，预计周五恢复至 23:30 供应。进展会同步在你的诉求跟踪里。', age: '-20 hours' },
      { post: 1, user: 'xiaoman', body: '收到！感谢回复，坐等周五。', age: '-19 hours', parent: 5 },
      { post: 2, user: 'linlin', body: '时间表太实用了，请问简历改了几版才定稿？', age: '-40 hours' },
      { post: 2, user: 'buaoye', body: '大改了四版。每次笔试挂了就回头改一次，简历是投出来的不是憋出来的。', age: '-38 hours', parent: 7 },
      { post: 2, user: 'demo', body: '收藏了，大二的我先把项目做起来。', age: '-30 hours' },
      { post: 3, user: 'xiaoman', body: '早八连排真的血泪教训，上学期差点挂在出勤上。', age: '-2 days' },
      { post: 4, user: 'linlin', body: '李老师，请问周五那场可以线上旁听吗？实习走不开。', age: '-26 hours' },
      { post: 4, user: 'teacher_li', body: '可以，我开个会议链接，周五中午发在这个帖子里。', age: '-25 hours', parent: 11 },
      { post: 5, user: 'wang', body: '帮毕业学长顶一下，这个价格很实在了。', age: '-6 hours' },
      { post: 6, user: 'xiaoman', body: '手机党可以参加太好了，怎么报名？', age: '-10 hours' },
      { post: 6, user: 'demo', body: '在社团招新墙扫码就行，本周六下午还有线下摊位。', age: '-9 hours', parent: 14 },
      { post: 7, user: 'buaoye', body: '找实习的角度：先 Java 打基础，Go 上手很快，真到面试拼的是计网、数据库这些底子。', age: '-5 hours' },
      { post: 7, user: 'teacher_li', body: '同意楼上。语言只是载体，把《操作系统》和《计算机网络》学扎实，切换成本很低。', age: '-4 hours' },
      { post: 8, user: 'wang', body: '图书馆是有 30 分钟离座规则的，可以找值班老师登记处理。', age: '-4 hours' },
      { post: 8, user: 'tushuguan', body: '同学你好，四楼自习区实行"离座超过 30 分钟可清桌"规则，前台有登记本，也欢迎通过诉求通道反馈高发时段，我们会加强巡查。', age: '-3 hours' },
      { post: 9, user: 'buaoye', body: '过来人建议：大二把英语和数学基础打牢就是在准备考研，不必焦虑"正式开始"的仪式感。', age: '-3 hours' },
      { post: 9, user: 'wang', body: '我是大三下才定的目标，照样来得及，但英语真的要早点开始。', age: '-2 hours' },
      { post: 10, user: 'demo', body: '试过了，微辣也挺香，就是 12 点去排了二十分钟。', age: '-25 hours' },
    ]
    const commentIds: number[] = []
    for (const c of commentSeeds) {
      const result = insertComment.run({
        postId: postIds[c.post],
        userId: users[c.user],
        parentId: c.parent === undefined ? null : commentIds[c.parent],
        body: c.body,
        anonymous: c.anonymous ?? 0,
        age: c.age,
      })
      commentIds.push(Number(result.lastInsertRowid))
    }

    const likeSeeds: Array<[number, string[]]> = [
      [0, ['demo', 'zhou', 'xiaoman', 'buaoye', 'wang', 'teacher_li']],
      [1, ['zhou', 'demo', 'linlin', 'wang']],
      [2, ['linlin', 'demo', 'zhou', 'xiaoman', 'wang', 'mod', 'teacher_li']],
      [3, ['xiaoman', 'demo', 'linlin', 'zhou', 'buaoye']],
      [4, ['linlin', 'demo', 'zhou']],
      [5, ['wang']],
      [6, ['xiaoman', 'linlin', 'wang', 'zhou']],
      [7, ['buaoye', 'demo']],
      [8, ['wang', 'linlin', 'demo', 'buaoye']],
      [9, ['buaoye', 'wang', 'linlin']],
      [10, ['demo', 'xiaoman', 'linlin']],
    ]
    for (const [postIndex, names] of likeSeeds) {
      for (const name of names) insertLike.run(users[name], 'post', postIds[postIndex])
    }
    const commentLikeSeeds: Array<[number, string[]]> = [
      [3, ['linlin', 'demo', 'zhou']],
      [5, ['xiaoman', 'zhou', 'demo', 'linlin']],
      [8, ['linlin', 'demo']],
      [16, ['linlin', 'demo', 'wang']],
      [19, ['xiaoman', 'wang', 'demo']],
      [20, ['demo', 'wang']],
    ]
    for (const [commentIndex, names] of commentLikeSeeds) {
      for (const name of names) insertLike.run(users[name], 'comment', commentIds[commentIndex])
    }

    insertFavorite.run(users['demo'], postIds[2])
    insertFavorite.run(users['demo'], postIds[3])
    insertFavorite.run(users['linlin'], postIds[2])
    insertFavorite.run(users['xiaoman'], postIds[3])

    db.exec(`
      UPDATE posts SET like_count = (SELECT COUNT(*) FROM likes WHERE target_type = 'post' AND target_id = posts.id);
      UPDATE posts SET comment_count = (SELECT COUNT(*) FROM comments WHERE post_id = posts.id AND status = 'visible');
      UPDATE comments SET like_count = (SELECT COUNT(*) FROM likes WHERE target_type = 'comment' AND target_id = comments.id);
    `)

    const needSeeds = [
      { user: 'xiaoman', title: '南区宿舍热水供应时间恢复', body: '南区宿舍最近 22:30 后经常没有热水，影响晚归同学洗漱，希望确认原因并恢复原供应时间。', dept: '后勤服务中心', status: 'progress', anonymous: 0, age: '-3 days', updatedAge: '-5 hours' },
      { user: 'zhou', title: '图书馆三楼自习区增设插座', body: '三楼靠窗自习区插座太少，笔记本党经常要抢位置，建议沿墙增加一排插座。', dept: '图书馆', status: 'resolved', anonymous: 0, age: '-20 days', updatedAge: '-2 days' },
      { user: 'demo', title: '关于跨学院选课名额的建议', body: '热门通识课名额太少，跨学院同学几乎抢不到，建议按学院比例预留部分名额或增开平行班。', dept: '教务处', status: 'pending', anonymous: 1, age: '-30 hours', updatedAge: '-30 hours' },
      { user: 'linlin', title: '延长实验楼机房晚间开放时间', body: '期末季机房 21:30 关门太早，很多课程大作业需要实验环境，希望期末两周延长到 23:00。', dept: '教务处', status: 'accepted', anonymous: 0, age: '-4 days', updatedAge: '-26 hours' },
    ]
    const needIds: number[] = []
    for (const n of needSeeds) {
      const result = insertNeed.run({ userId: users[n.user], title: n.title, body: n.body, dept: n.dept, status: n.status, anonymous: n.anonymous, age: n.age, updatedAge: n.updatedAge })
      needIds.push(Number(result.lastInsertRowid))
    }
    insertNeedUpdate.run(needIds[0], users['houqin'], 'accepted', '已受理。经排查为南区热水管道老化渗漏，需要停水检修。', '-2 days')
    insertNeedUpdate.run(needIds[0], users['houqin'], 'progress', '检修进行中，预计本周五恢复至 23:30 供应，完工后将持续观察三天。', '-5 hours')
    insertNeedUpdate.run(needIds[1], users['tushuguan'], 'accepted', '已受理，正在评估三楼配电容量。', '-18 days')
    insertNeedUpdate.run(needIds[1], users['tushuguan'], 'progress', '施工方案已确定，将于周末闭馆时段施工，避免影响自习。', '-10 days')
    insertNeedUpdate.run(needIds[1], users['tushuguan'], 'resolved', '三楼靠窗区已新增 24 个插座并通电验收，欢迎使用并反馈问题。', '-2 days')
    insertNeedUpdate.run(needIds[3], users['jiaowu'], 'accepted', '已受理。正在与信息中心确认机房值守和门禁调整方案，本周内给出答复。', '-26 hours')

    const followSeeds: Array<[number, string[]]> = [
      [0, ['zhou', 'demo', 'linlin', 'wang', 'buaoye']],
      [1, ['linlin', 'demo', 'xiaoman', 'wang']],
      [2, ['linlin', 'zhou', 'xiaoman']],
      [3, ['demo', 'zhou', 'buaoye', 'xiaoman']],
    ]
    for (const [needIndex, names] of followSeeds) {
      for (const name of names) insertNeedFollow.run(users[name], needIds[needIndex])
    }

    insertReport.run(users['linlin'], '', 'post', postIds[5], '疑似违规交易', '评论区有人冒充卖家私聊压价，建议核实发帖人身份。', '-3 hours')

    insertNotification.run(users['demo'], 'comment', users['buaoye'], 'post', postIds[9], '学长不熬夜 评论了你的帖子《大二要不要开始准备考研？想听听过来人的想法》', '-3 hours')
    insertNotification.run(users['demo'], 'like', users['xiaoman'], 'post', postIds[9], '小满 赞了你的帖子《大二要不要开始准备考研？想听听过来人的想法》', '-2 hours')
    insertNotification.run(users['demo'], 'system', null, null, null, '欢迎加入嘉大圈。实名信息仅用于安全验证，前台展示昵称，发言请遵守社区公约。', '-128 days')

    insertAudit.run('ai', 'ai-guard-01', 'FLAG_PENDING', 'post', postIds[11], 'AI 初审判定高风险：疑似诈骗话术（转账/汇款/押金 + 私下联系）', '-35 minutes')
    insertAudit.run('ai', 'ai-guard-01', 'AUTO_PASS', 'post', postIds[10], 'AI 初审判定低风险，自动放行', '-27 hours')
    insertAudit.run('user', 'mod', 'APPROVE', 'post', postIds[8], '批评性表达，未发现违规，人工复核通过', '-4 hours')
  })
  run()
}
