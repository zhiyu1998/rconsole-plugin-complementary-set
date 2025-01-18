import PQueue from 'p-queue';
import fs from "fs";
import puppeteer from "../../../lib/puppeteer/puppeteer.js";

const queue = new PQueue({ concurrency: 20 });

// TODO 这里需要修改你的QQ号
const masterId = "";
// TODO 是否启动文字版的TODO，防止部分机子无法看到TODO
let isText = false;
// TODO 填写你发言后小秘书将在这个时间内不撤回群友发言，默认5分钟（5 x 60 x 1000ms）
const atTime = 300000;

// 会动态获取
let masterName = "";
// true-忙碌 false-随时找我
let masterStatus = true;
let todoList = {}
// 发言定时器，不需要修改
let myVariable = false;
// 存储当前定时器的 ID
let timerId = null;

export class Secretary extends plugin {
    constructor() {
        super({
            name: "[R插件补集]小秘书",
            dsc: "让机器人抵挡at，然后制作成 TODO 后续统一处理",
            event: "message",
            priority: 99999,
            rule: [
                {
                    reg: "^(?!.*(小秘书切换状态|小秘书TODO|小秘书cls|小秘书我要)).+$",
                    fnc: "withstand",
                },
                {
                    reg: "^小秘书切换状态$",
                    fnc: "switchStatus",
                    permission: "master"
                },
                {
                    reg: "^小秘书TODO$",
                    fnc: "todoList",
                },
                {
                    reg: "^小秘书cls$",
                    fnc: "todoCls",
                },
                {
                    reg: "^小秘书我要",
                    fnc: "getSpecialTitle",
                }
            ]
        })
    }

    async translate_en2zh(e) {
        const translateResultResp = await fetch(`http://api.yujn.cn/api/fanyi.php?msg=${encodeURIComponent(e.msg)}`, {
            method: "POST",
            headers: {
                'Content-Type': 'application/json'
            }
        }).then(resp => resp.text());
        e.reply(`小秘书自动翻译：\n${translateResultResp.split("翻译后：")?.[1] || ""}`, true);
    }

    // 互联网抽象话翻译
    async canUSpeak(e) {
        const resp = await fetch(`https://lab.magiconch.com/api/nbnhhsh/guess`, {
            method: "POST",
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                "text": e.msg
            })
        }).then(resp => resp.json());
        const guess = resp?.[0].trans || resp?.[0].inputting;
        e.reply(`小秘书自动理解抽象语言：\n${Array.isArray(guess) ? guess.join("、") : guess}`, true);
    }

    async withstand(e) {
        queue.add(async () => {
            // 自主翻译
            e.msg = e.msg.replace(/[-_]/g, ' ');
            if (e.msg !== undefined && isAllEnglishWithPunctuation(e.msg)) {
                if (isSingleWord(e.msg)) {
                    await this.canUSpeak(e);
                } else {
                    await this.translate_en2zh(e);
                }
            }
            // 如果发言人是主人，那么就重置时间
            if (String(e.user_id) === masterId) {
                resetTimer(atTime);
            }
            // 如果不是 at 主人就直接返回
            if (e.at !== masterId || myVariable === true) {
                return;
            }
            if (masterName === "") {
                const friends = await e.bot.sendApi("get_friend_list");
                masterName = friends.find(friend => {
                    return friend.uin === masterId;
                }).nickname;
                logger.info("[小秘书] 找到主人的昵称，已经设置完成！");
            }
            // 检查是否需要静音at
            if (masterStatus === true) {
                await e.bot.sendApi("delete_msg", {
                    message_id: e.message_seq || e.message_id
                });
                e.reply(`👋 Hi，这里是${masterName}的小秘书\n\n👨‍💻 ${masterName}正在忙碌哦~~！\n\n忙完就会回复你了哟~！🤟😘`, true);
            }
            const { user_id, nickname, card } = e.sender;
            const groupId = e.group_id;
            const message = e.msg;
            if (!todoList[groupId]) {
                todoList[groupId] = {};
            }
            if (!Array.isArray(todoList[groupId][user_id])) {
                todoList[groupId][user_id] = [];
            }
            logger.info(todoList);
            todoList[groupId][user_id].push(`${card || nickname}：${message || ''}`);
            logger.info(`[小秘书] 记录${user_id}到 TODO 完成`);
            return true;
        })
    }

    async switchStatus(e) {
        masterStatus = !masterStatus;
        logger.info(masterStatus);
        e.reply(`状态已经切换为：${masterStatus === true ? "忙碌" : "随时找我"}`);
    }

    async todoList(e) {
        const groupId = e.group_id;
        const curGroupTodoList = todoList[groupId] = todoList[groupId] || {};
        // 如果启用了文字版逻辑
        if (isText) {
            let keys = "";
            for (let key of Object.keys(curGroupTodoList)) {
                let content = `${key}: \n`;
                for (let item of curGroupTodoList[key]) {
                    content += `- ${item}\n`;
                }
                keys += content + "\n";
            }
            e.reply(`群友需求 Todo List：\n${keys}`, true);
            return;
        }
        const finalHTML = renderHTML(curGroupTodoList);
        let browser = null;
        try {
            // 打开一个新的页面
            browser = await puppeteer.browserInit();
            const page = await browser.newPage();
            await page.setViewport({
                width: 1280,
                height: 720,
                deviceScaleFactor: 10, // 根据显示器的分辨率调整比例，2 是常见的 Retina 显示比例
            });
            // 设置页面内容为包含 Base64 图片的 HTML
            await page.setContent(finalHTML, {
                waitUntil: "networkidle0",
            });
            // 直接截图该元素
            await page.screenshot({
                path: "./todo.png",
                type: "jpeg",
                fullPage: true,
                omitBackground: false,
                quality: 50,
            });
            await e.reply(segment.image(fs.readFileSync("./todo.png")));
            await browser.close();
        } catch (error) {
            logger.error(`截图失败: ${error}`);
            if (browser) {
                await browser.close();
            }
        }
    }

    async todoCls(e) {
        todoList = {};
        e.reply("已清除所有 TODO");
        return true;
    }

    async getSpecialTitle(e) {
        const title = e.msg.replace(/^小秘书我要/, "").trim();
        logger.info(title);
        await e.bot.sendApi("set_group_special_title", {
            group_id: e.group_id,
            user_id: e.user_id,
            special_title: title,
        });
        e.reply(`已为你设置了群荣誉：${title}`, true);
    }
}

function isAllEnglishWithPunctuation(str) {
    // 先检查字符串是否为纯数字或计量单位
    if (/^\d+(?!([bgkmt]|kb|mb|gb)$)/.test(str)) {
        return false; // 直接返回 false
    }
    
    // 检查字符串是否为纯符号
    if (/^[!"#$%&'()*+,\-.\/:;<=>?@[\]^_`{|}~]+$/.test(str)) {
        return false; // 纯标点符号返回 false
    }
    str = str.replace(/[-_]/g, ' ');
    
    // 创建不匹配缩写数组，用户可自行添加修改
    const words = ['sb', 'cnm', 'ok', 'ba', 'by', 'hd', 'mp3', 'mp4', 'avi', 'av', 'bv', 'gv', 'mp5', 'mp7', 'mkv', 'jpg', 'pdf', 'txt', 'exe', 'exo', 'gif', 'png', 'bt', 'doro', 'OK', 'wc', 'ljt', 'sjb', 'cjb', 'byd', 'bs', 'sd', 'nb', 'yes', 'no', 'hh', 'steam', 'csgo', 'xx', 'ww', 'vv', 'qs', 'td', 'sgl', 'yy', 'oo', 'pp', 'mc', 'emm', 'lol', 'wyy', 'zfb', 'wx', 'qq', 'tx', 'wb', 'cnd', 'fnmdp', 'csn', 'dnlm', 'xhs', 'dy', 'gg', 'nt', 'xbx', 'lpl', 'kpl', 'bl', 'gl', 'hb', 'xb', 'ntm', 'wtm', 'ctm', 'rnd', 'nm', 'nmd', 'jj', 'kk', 'dd', 'cc', 'sb', 'lj', 'tt', 'fw', 'rnm', 'rmb', 'cs', 'cf', 'op', 'blbl', 'xyz', 'cn', 'jp', 'cnm', 'cn', 'dnm', 'us', 'usa', 'uk', 'tg', 'qaq', 'tat', 'orz', 'ovo', 'emmm', 'owo', 'good', 'omg', 'bad', 'god', 'apple', 'r18g', 'o.o', '0.0', 'hhh', 'xxx', 'ooo', 'hhhh', 'nmb', 'mdzz', 'qtmd', 'ff', 'wy', 'lcs', 'vivo', 'oppo'];

    // 将 words 中的所有单词转换为小写
    const lowerCaseWords = words.map(word => word.toLowerCase());
    
    // 将 str 转换为小写
    const lowerCaseStr = str.toLowerCase();

    if (lowerCaseWords.includes(lowerCaseStr)) {
        return false;   // 数组匹配直接返回 false
    }

    // 正则表达式匹配英文字母、数字、空格、常见标点符号，以及一些特殊符号
    const regex = /^[A-Za-z0-9\s.,;:'"()%\-–—!?‘’“”_]+$/;
    
    // 检查字符串不是单独的问号
    return regex.test(str) && str !== '?';
}

function isSingleWord(str) {
    // 先去掉首尾空格
    str = str.trim();

    // 使用正则表达式匹配单个单词（仅包含字母或数字）
    const regex = /^[A-Za-z0-9]+$/;

    // 返回是否匹配单个单词
    return regex.test(str);
}


// 启动或重置定时器
function resetTimer(duration) {
    // 如果有现存的定时器，先清除它
    if (timerId !== null) {
        clearTimeout(timerId);
        logger.info('[小秘书] 计时器已重置');
    }

    // 设置变量为true，表示计时开始
    myVariable = true;
    logger.info(`[小秘书] 主人发言计时开始：${myVariable}`);

    // 创建一个新的定时器
    timerId = setTimeout(() => {
        // 定时结束后将变量置为false
        myVariable = false;
        logger.info(`[小秘书] 主人发言计时结束：${myVariable}`);
        timerId = null; // 定时器结束后清除ID
    }, duration);
}

const renderHTML = (curGroupTodoList) => {
    return `
    <!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>群友需求 Todo List</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f0f2f5;
            color: #333;
        }
        h1 {
            text-align: center;
            color: #1a73e8;
            font-size: 2.5em;
            margin-bottom: 30px;
        }
        .todo-list {
            list-style-type: none;
            padding: 0;
        }
        .todo-item {
            display: flex;
            background-color: #ffffff;
            border: 1px solid #e1e4e8;
            margin-bottom: 15px;
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            transition: all 0.3s ease;
        }
        .todo-item:hover {
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
            transform: translateY(-2px);
        }
        .user-info {
            display: flex;
            flex-direction: column;
            align-items: center;
            margin-right: 20px;
            width: 120px;
        }
        .user-info img {
            width: 70px;
            height: 70px;
            border-radius: 50%;
            margin-bottom: 10px;
            border: 3px solid #1a73e8;
            transition: all 0.3s ease;
        }
        .todo-item:hover .user-info img {
            transform: scale(1.05);
        }
        .user-details {
            text-align: center;
            font-size: 12px;
            color: #666;
        }
        .user-details div {
            margin-bottom: 3px;
        }
        .todo-content {
            flex-grow: 1;
            display: flex;
            align-items: center;
            font-size: 16px;
            line-height: 1.5;
            color: #24292e;
        }
        @media (max-width: 600px) {
            .todo-item {
                flex-direction: column;
                align-items: center;
            }
            .user-info {
                margin-right: 0;
                margin-bottom: 15px;
            }
            .todo-content {
                text-align: center;
            }
        }
    </style>
</head>
<body>
    <ul class="todo-list">
        ${Object.keys(curGroupTodoList).map(key => {
        return `
            <li class="todo-item">
                <div class="user-info">
                    <img src="http://q1.qlogo.cn/g?b=qq&nk=${key}&s=100" alt="用户头像">
                    <div class="user-details">
                        <div>ID: ${key}</div>
                    </div>
                </div>
                <div class="todo-content">
                    ${curGroupTodoList[key]}
                </div>
            </li>
            `
    })}
    </ul>
</body>
</html>
    `
}
