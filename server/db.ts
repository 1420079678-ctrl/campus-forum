import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { hashPassword, verifyPassword } from './password.js'

const dbPath = resolve(process.env.CAMPUS_FORUM_DB ?? './data/campus-forum.db')
mkdirSync(dirname(dbPath), { recursive: true })

export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const SCHEMA_VERSION = 9
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
if (currentVersion < 7) {
  db.exec(`
    UPDATE posts SET body = '最近晚上十点半之后经常没有热水，想确认一下是临时维修还是新的供应时间。已经在校园服务小程序提交过一次反馈，有同样情况的同学可以在评论区互相同步消息。'
      WHERE title = '南区宿舍热水供应时间有调整吗？';

    INSERT INTO comments (post_id, user_id, body, anonymous, created_at)
    SELECT p.id, u.id, '[[sticker:heart]]', 0, datetime('now', '-12 hours')
    FROM posts p JOIN users u ON u.username = 'xiaoman'
    WHERE p.title = '分享一份真实的暑期实习准备路线（含时间表）'
      AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.post_id = p.id AND c.body = '[[sticker:heart]]');

    UPDATE posts SET comment_count = (
      SELECT COUNT(*) FROM comments c WHERE c.post_id = posts.id AND c.status = 'visible'
    );
  `)
}
if (currentVersion < 8) {
  seedCampusScenes()
}
if (currentVersion < 9) {
  db.exec(`
    ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT '';
    UPDATE users SET avatar = CASE (id % 12)
      WHEN 0 THEN '🧩' WHEN 1 THEN '🌿' WHEN 2 THEN '🎧' WHEN 3 THEN '📚'
      WHEN 4 THEN '🏸' WHEN 5 THEN '📷' WHEN 6 THEN '☕' WHEN 7 THEN '🐱'
      WHEN 8 THEN '🪐' WHEN 9 THEN '🎨' WHEN 10 THEN '🛼' ELSE '🌻' END
    WHERE avatar = '';
  `)
}
db.pragma(`user_version = ${SCHEMA_VERSION}`)

function seedCampusScenes() {
  const insertStudent = db.prepare(`
    INSERT OR IGNORE INTO users (
      username, password_hash, nickname, role, dept, grade, bio, verified, status,
      campus, verification_status, created_at
    ) VALUES (@username, @passwordHash, @nickname, 'student', @dept, @grade, @bio, 1, 'active',
      '嘉兴大学', 'verified', datetime('now', @age))
  `)
  const insertPost = db.prepare(`
    INSERT INTO posts (
      user_id, board_id, title, body, tags, images, anonymous, status, featured,
      view_count, risk_level, risk_reasons, created_at, updated_at
    )
    SELECT u.id, b.id, @title, @body, @tags, '[]', 0, 'visible', 0,
      @viewCount, 'low', '[]', datetime('now', @age), datetime('now', @age)
    FROM users u JOIN boards b ON b.name = @board
    WHERE u.username = @user
      AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.title = @title)
  `)
  const getPost = db.prepare('SELECT id FROM posts WHERE title = ?')
  const insertComment = db.prepare(`
    INSERT INTO comments (post_id, user_id, body, anonymous, created_at)
    SELECT @postId, u.id, @body, 0, datetime('now', @age)
    FROM users u WHERE u.username = @user
      AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.post_id = @postId AND c.body = @body)
  `)
  const insertLike = db.prepare(`
    INSERT OR IGNORE INTO likes (user_id, target_type, target_id)
    SELECT id, 'post', @postId FROM users WHERE username = @user AND status = 'active'
  `)

  const run = db.transaction(() => {
    const students = [
      ['seed_yutong', '俞桐', '设计学院', '大二', '喜欢拍照、逛展和把校园生活记下来。'],
      ['seed_ake', '阿柯', '信息科学与工程学院', '大三', '代码、骑行、羽毛球。'],
      ['seed_beibei', '贝贝', '商学院', '大一', '还在解锁嘉大的每个角落。'],
      ['seed_nanfeng', '南风', '建筑工程学院', '大二', '暑期留校中，偶尔出没在操场。'],
      ['seed_orange', '橘子汽水', '外国语学院', '大三', '探店和英语学习两手抓。'],
      ['seed_mumu', '木木', '师范学院', '大二', '自习搭子长期招募。'],
      ['seed_xiaoyu', '小宇', '材料与纺织工程学院', '大三', '喜欢折腾数码，也爱捡漏。'],
      ['seed_qiqi', '七七', '生物与化学工程学院', '大一', '校园猫观察员。'],
    ] as const
    students.forEach(([username, nickname, dept, grade, bio], index) => insertStudent.run({
      username, nickname, dept, grade, bio,
      passwordHash: hashPassword(randomUUID()),
      age: `-${48 + index * 7} days`,
    }))

    const posts = [
      { user: 'seed_xiaoyu', board: '闲置集市', title: '毕业季出宿舍小冰箱，南区自取', body: '用了两年，制冷正常，内部已经清洗消毒。尺寸适合放宿舍桌下，原价四百多，现在 120 出。只接受校内当面看货，南区宿舍楼下自取，不收任何定金。', tags: ['二手', '宿舍好物', '校内自取'], views: 186, age: '-45 minutes', comments: [['seed_beibei', '请问噪音大吗？晚上放宿舍会不会影响睡觉？'], ['seed_xiaoyu', '低档基本听不到，高档压缩机启动时会有一点声音，可以先来看。']] },
      { user: 'seed_ake', board: '闲置集市', title: '收一台 24 寸显示器，预算 300 左右', body: '暑期留校做项目，想收一台能竖屏的显示器，1080P 就够用。最好在越秀校区附近，可以当面测试亮点和接口，价格看成色商量。', tags: ['二手', '数码', '求购'], views: 93, age: '-2 hours', comments: [['linlin', '我有一台 AOC 24 寸，支架不能旋转但可以送竖屏支架。'], ['seed_ake', '可以，方便的话站内私信发一下型号。']] },
      { user: 'seed_nanfeng', board: '闲置集市', title: '出两支胜利入门羽毛球拍，带拍包', body: '社团训练换拍后闲置，两支都重新拉过 24 磅线，拍框有正常使用痕迹，没有裂纹。两支一起 150，体育馆附近面交，可以现场试挥。', tags: ['二手', '羽毛球', '运动装备'], views: 128, age: '-4 hours', comments: [['seed_mumu', '新手女生用会不会太重？'], ['seed_nanfeng', '都是 4U，比较轻，第一次打也能用。']] },
      { user: 'wang', board: '闲置集市', title: '毕业整理：考研政治资料免费送', body: '肖四肖八和自己的错题整理都还在，部分有笔记。免费送给准备考研的学弟学妹，不邮寄，东区食堂门口自取。希望拿走后真的会用，不要二次转卖。', tags: ['闲置', '考研资料', '免费送'], views: 241, age: '-7 hours', comments: [['demo', '想要错题整理，已经站内私信你了。'], ['wang', '收到，今晚七点之后可以来拿。']] },
      { user: 'seed_beibei', board: '校园生活', title: '明早东门取快递，求顺路带到越秀宿舍', body: '明天早上有个小件快递到东门驿站，但我八点有课赶不过去。有没有九点前会经过东门的同学愿意顺路带到越秀宿舍楼下？有一杯奶茶感谢，取件码走站内私信。', tags: ['跑腿', '同学互助', '快递'], views: 104, age: '-35 minutes', comments: [['seed_orange', '我明早八点半会经过，可以帮你带。'], ['seed_beibei', '太感谢了，我私信你取件信息。']] },
      { user: 'seed_mumu', board: '校园生活', title: '求帮忙打印装订一份比赛材料', body: '人在校外参加调研，今晚九点前需要把 28 页材料双面打印并胶装，送到经管楼值班室。打印和跑腿费用都可以报销，有空的同学请站内联系。', tags: ['跑腿', '打印', '比赛'], views: 77, age: '-3 hours', comments: [['demo', '文印店八点半关门，建议尽快发文件。'], ['seed_mumu', '已经找到同学帮忙了，谢谢大家。']] },
      { user: 'zhou', board: '校园生活', title: '周五下午嘉兴南站回学校，有人拼车吗', body: '周五 15:20 到嘉兴南站，一个行李箱。想找两三位同学一起打车回越秀校区，车费按平台实际金额平摊，全程在站内沟通。', tags: ['拼车', '跑腿', '返校'], views: 163, age: '-5 hours', comments: [['seed_nanfeng', '我 15:12 到站，可以一起。'], ['zhou', '好，我建个站内小群前再确认到站时间。']] },
      { user: 'seed_qiqi', board: '校园生活', title: '暑期留校，找同学帮忙喂三天猫', body: '周末临时回家，猫在校外租房，需要周五晚到周日晚每天加一次粮、换水并拍照反馈。距离北门步行五分钟，会提前准备好用品，优先有养猫经验的同学。', tags: ['跑腿', '宠物', '暑期留校'], views: 152, age: '-9 hours', comments: [['seed_yutong', '我养过猫，周末也在学校，可以先见面熟悉一下。'], ['seed_qiqi', '好呀，我站内联系你，谢谢！']] },
      { user: 'xiaoman', board: '校园生活', title: '梁林校区捡到一张校园卡，已交保卫室', body: '今天 12:40 在一食堂门口捡到校园卡，姓名最后一个字是“宁”。已经交到附近保卫室，失主带上能证明身份的信息去领取，不要在评论区公开学号。', tags: ['失物招领', '校园卡', '梁林校区'], views: 219, age: '-55 minutes', comments: [['seed_beibei', '帮顶，卡主应该很着急。'], ['seed_orange', '已转到班群，注意保护学号做得很好。']] },
      { user: 'seed_orange', board: '校园生活', title: '寻找蓝色 AirPods 耳机盒，可能落在图书馆', body: '昨晚九点左右从图书馆二楼到东门这段路上丢了一个蓝色硅胶耳机盒，外壳挂着一个小橘子挂件。耳机还在我这里，捡到盒子的同学请站内联系，有奶茶感谢。', tags: ['失物', '寻物', '图书馆'], views: 133, age: '-2 hours', comments: [['seed_yutong', '二楼服务台问过了吗？那里有失物箱。'], ['seed_orange', '刚问过暂时没有，我晚点再去一次。']] },
      { user: 'seed_nanfeng', board: '校园生活', title: '体育馆二楼捡到一副黑框眼镜', body: '今晚羽毛球场散场后在 7 号场边捡到黑框眼镜，镜腿内侧有一串白色字母。暂时放在体育馆前台，失主描述一下眼镜盒颜色即可领取。', tags: ['失物招领', '体育馆', '眼镜'], views: 88, age: '-4 hours', comments: [['linlin', '我们群里有人在找，已经把帖子发给他了。'], ['seed_nanfeng', '谢谢，前台九点半下班，最好今晚去。']] },
      { user: 'demo', board: '校园生活', title: '教学楼门口拿错透明雨伞的同学看这里', body: '下午下雨时在五号楼门口拿到一把很像自己的透明伞，回宿舍才发现伞柄贴着一只黄色小鸭。我自己的伞柄有绿色胶带，应该是互相拿错了，可以约食堂门口换回来。', tags: ['失物', '雨伞', '拿错'], views: 146, age: '-8 hours', comments: [['seed_mumu', '黄色小鸭是我的！我拿到的那把正好有绿色胶带。'], ['demo', '破案了，我私信你约时间。']] },
      { user: 'seed_nanfeng', board: '社团活动', title: '暑期晨跑搭子：每周一三五操场见', body: '暑期留校不想一直宅宿舍，计划每周一三五早上 6:40 在越秀操场慢跑三公里，配速七分左右，新手友好。下雨就改成室内拉伸，不卷速度，只求互相叫醒。', tags: ['搭子', '晨跑', '暑期留校'], views: 174, age: '-70 minutes', comments: [['seed_qiqi', '七分配速可以，周三开始算我一个。'], ['seed_nanfeng', '欢迎，周三 6:35 操场入口集合。']] },
      { user: 'seed_mumu', board: '社团活动', title: '图书馆六级搭子，想一起坚持到考试', body: '准备十二月六级，计划工作日晚上七点到九点在图书馆三楼：一小时真题，一小时听力和复盘。想找两三位能稳定出勤的同学，学院不限，基础一般也没关系。', tags: ['搭子', '英语六级', '自习'], views: 201, age: '-3 hours', comments: [['xiaoman', '我听力比较弱，可以一起吗？'], ['seed_mumu', '当然可以，我们正好可以分工整理错题。']] },
      { user: 'linlin', board: '社团活动', title: '周四晚羽毛球新手局，还差两个人', body: '周四 19:00-21:00 体育馆订了两个场，目前四个人，还差两位。水平都是能对打但不专业，球费和场地费 AA，拍子不够可以借，拒绝压力局。', tags: ['搭子', '羽毛球', '新手局'], views: 265, age: '-5 hours', comments: [['seed_beibei', '我和室友两个新手，可以一起吗？'], ['linlin', '正好满员，我把场地号私信你。']] },
      { user: 'seed_orange', board: '社团活动', title: '周末市区探店搭子，想去吃新开的融合菜', body: '周六傍晚想去月河附近新开的融合菜，人均大概 70。本人女生，大三，比较喜欢拍照但不会一直等出片。想找一两位同学一起，先在校内公共区域见面再出发。', tags: ['搭子', '探店', '周末'], views: 179, age: '-10 hours', comments: [['seed_yutong', '我也收藏了那家，拍照速度很快哈哈。'], ['seed_orange', '听起来很合拍，我站内找你。']] },
      { user: 'seed_yutong', board: '社团活动', title: '草坪音乐夜开放报名，会乐器不会乐器都能来', body: '本周六 19:00 在大学生活动中心旁草坪办小型音乐夜，有吉他、键盘和开放麦。观众不用报名，想上台的同学在评论区写节目类型，我们会站内联系确认设备需求。', tags: ['校园活动', '音乐', '开放麦'], views: 388, age: '-90 minutes', comments: [['demo', '纯观众可以带野餐垫吗？'], ['seed_yutong', '可以，但请不要挡住中间通道，结束后带走垃圾。']] },
      { user: 'seed_yutong', board: '社团活动', title: '周日校园摄影散步：只带手机也欢迎', body: '周日下午四点从图书馆出发，沿河边走到老教学楼，主题是“夏天的绿色”。不讲复杂参数，主要交换构图思路，手机和相机都可以，预计一个半小时。', tags: ['校园活动', '摄影', '散步'], views: 216, age: '-4 hours', comments: [['xiaoman', '零基础手机党报名！'], ['seed_yutong', '欢迎，记得提前清一点手机存储空间。']] },
      { user: 'buaoye', board: '社团活动', title: '大学生创新项目路演，招募现场体验观众', body: '周五下午在经管楼报告厅有六个学生项目做阶段路演，需要招募 30 位体验观众填写匿名反馈。全程约 90 分钟，会提供饮料和项目纪念贴纸，适合对创业比赛感兴趣的同学。', tags: ['校园活动', '创新创业', '路演'], views: 194, age: '-7 hours', comments: [['seed_ake', '计算机学院的项目多吗？'], ['buaoye', '六个里面有两个数字校园方向，欢迎来提意见。']] },
      { user: 'seed_qiqi', board: '社团活动', title: '校园流浪动物志愿者暑期补招', body: '暑期留校人少，现补招几位志愿者协助定点添粮、清洁和记录校园猫状态。每人每周认领一次时段，不允许随意投喂人类食物，也不要擅自抓猫。会统一培训。', tags: ['校园活动', '志愿者', '校园猫'], views: 307, age: '-11 hours', comments: [['seed_beibei', '大一可以参加吗？暑期大部分时间都在。'], ['seed_qiqi', '可以，第一次会有老志愿者带着走一遍。']] },
      { user: 'seed_qiqi', board: '校园生活', title: '东区小橘猫今天终于肯靠近人了', body: '连续观察一周，东区那只戴反光项圈的小橘猫精神很好，今天下午在树荫下主动靠近了志愿者。提醒大家不要追着抱，也不要喂火腿肠，远距离看看就好。', tags: ['宠物', '校园猫', '日常'], views: 351, age: '-6 hours', comments: [['seed_yutong', '是尾巴尖有一点白的那只吗？'], ['seed_qiqi', '对，就是它，项圈上还有联系方式牌。']] },
      { user: 'seed_ake', board: '课程学业', title: '暑期互联网+竞赛组队，缺一位视觉设计', body: '目前队里有产品、开发和商科同学，项目方向是校园闲置循环。原型和基础数据已经完成，缺一位能做视觉系统和路演版式的同学。不是临时挂名，希望每周能稳定开一次会。', tags: ['搭子', '竞赛组队', '视觉设计'], views: 223, age: '-13 hours', comments: [['seed_yutong', '可以先看看现有原型和时间安排吗？'], ['seed_ake', '可以，我把脱敏版原型通过站内私信发你。']] },
      { user: 'seed_ake', board: '社团活动', title: '周三晚绿道轻松夜骑，均速 18 左右', body: '周三 19:10 北门集合，走绿道往返大约 22 公里，预计两个小时。必须戴头盔和带车灯，中途不竞速，新手跟不上会等。天气预报下雨则在帖子里取消。', tags: ['搭子', '骑行', '夜骑'], views: 196, age: '-15 hours', comments: [['seed_nanfeng', '共享单车能跟吗？'], ['seed_ake', '不建议，距离有点长，普通通勤车可以。']] },
      { user: 'seed_beibei', board: '校园生活', title: '第一次暑期留校，有哪些食堂窗口还开着', body: '刚开始暑期留校，发现食堂窗口比平时少很多。想整理一份还在营业的窗口和时间，方便大家少跑空。有确认过的同学可以评论窗口、楼层和大概营业时间，我会汇总到正文。', tags: ['暑期留校', '食堂', '校园互助'], views: 284, age: '-18 hours', comments: [['seed_orange', '二楼面档中午开到一点半，晚上五点到七点。'], ['demo', '一楼早餐窗口七点到九点还在，周末也开。']] },
    ] as const

    const likerPool = ['linlin', 'xiaoman', 'demo', 'zhou', 'wang', 'seed_yutong', 'seed_ake', 'seed_beibei', 'seed_nanfeng', 'seed_orange', 'seed_mumu', 'seed_qiqi']
    posts.forEach((post, index) => {
      insertPost.run({
        user: post.user, board: post.board, title: post.title, body: post.body,
        tags: JSON.stringify(post.tags), viewCount: post.views, age: post.age,
      })
      const row = getPost.get(post.title) as { id: number } | undefined
      if (!row) return
      post.comments.forEach(([user, body], commentIndex) => insertComment.run({
        postId: row.id, user, body, age: `-${Math.max(10, 35 + index * 9 - commentIndex * 7)} minutes`,
      }))
      const likeCount = 3 + (index % 5)
      for (let offset = 0; offset < likeCount; offset += 1) {
        insertLike.run({ postId: row.id, user: likerPool[(index + offset) % likerPool.length] })
      }
    })

    db.exec(`
      UPDATE posts SET like_count = (SELECT COUNT(*) FROM likes WHERE target_type = 'post' AND target_id = posts.id);
      UPDATE posts SET comment_count = (SELECT COUNT(*) FROM comments WHERE post_id = posts.id AND status = 'visible');
    `)
  })
  run()
}

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
