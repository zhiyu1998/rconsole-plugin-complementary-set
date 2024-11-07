import PQueue from 'p-queue';
import fs from "fs";
import puppeteer from "../../../lib/puppeteer/puppeteer.js";

const queue = new PQueue({ concurrency: 20 });

// TODO 这里需要修改你的QQ号
const masterId = "";

// 会动态获取
let masterName = "";
// true-忙碌 false-随时找我
let masterStatus = true;
let todoList = {}

export class Secretary extends plugin {
    constructor() {
        super({
            name: "小秘书",
            dsc: "让机器人抵挡at，然后制作成 TODO 后续统一处理",
            event: "message",
            priority: 9999,
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

    async withstand(e) {
        queue.add(async () => {
            if (e.at !== masterId) {
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
                e.reply(`👋 Hi，这里是${ masterName }的小秘书\n\n👨‍💻 ${ masterName }正在忙碌哦~~！\n\n忙完就会回复你了哟~！🤟😘`, true);
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
            todoList[groupId][user_id].push(`${ card || nickname }：${ message || '' }`);
            logger.info(`[小秘书] 记录${user_id}到 TODO 完成`);
            return true;
        })
    }

    async switchStatus(e) {
        masterStatus = !masterStatus;
        logger.info(masterStatus);
        e.reply(`状态已经切换为：${ masterStatus === true ? "忙碌" : "随时找我" }`);
    }

    async todoList(e) {
        const groupId = e.group_id;
        const curGroupTodoList = todoList[groupId] = todoList[groupId] || {};
        const finalHTML = renderHTML(curGroupTodoList);
        // 打开一个新的页面
        const browser = await puppeteer.browserInit();
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
    }

    async todoCls(e) {
        todoList = {};
        e.reply("已清除所有 TODO");
        return true;
    }

    async getSpecialTitle(e) {
        logger.info(e);
        const title = e.msg.replace(/^小秘书我要/, "").trim();
        await e.bot.sendApi("set_group_special_title", {
            group_id: e.group_id,
            user_id: e.user_id,
            special_title: title,
        });
        e.reply(`已为你设置了群荣誉：${ title }`, true);
    }
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
        ${ Object.keys(curGroupTodoList).map(key => {
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
