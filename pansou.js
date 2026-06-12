/**
 * PanSou 网盘搜索插件
 *
 * 使用方式：
 *   #pansou 速度与激情
 *   #pansou 速度与激情 -n 10
 *
 * 配置说明：
 *   1. 修改 pansouBaseURL 为你的 PanSou 服务地址。
 *   2. 未开启认证时，pansouToken / pansouUsername / pansouPassword 留空即可。
 *   3. 已开启认证时，可以直接填写 pansouToken；也可以填写账号密码，插件会自动登录获取 token。
 *   4. defaultPostParams 可以自定义 PanSou /api/search 的 POST 参数。
 */

import axios from "axios";
import fs from "fs";
import https from "https";

const pansouBaseURL = "https://localhost:8443";
const searchPath = "/api/search";
const loginPath = "/api/auth/login";

// 正式环境建议保持 true，并修复 PanSou/反代服务端证书链。
// 如果使用自签名证书，可临时改为 false，或填写 tlsCaFile 让 Node 信任自签名 CA。
const tlsRejectUnauthorized = false;
const tlsCaFile = "";

// 认证配置：优先使用 pansouToken；为空时，若账号密码不为空则自动登录获取 token。
const pansouUsername = "";
const pansouPassword = "";
const pansouToken = "";

// 自定义请求头，例如需要反代鉴权时可填：{ "X-Api-Key": "xxx" }
const customHeaders = {};

// 自定义 POST 请求参数，会和 kw 自动合并。
// PanSou 支持参数参考：https://github.com/fish2018/pansou
const defaultPostParams = {
    res: "merge",
    src: "all",
    refresh: false,
    // channels: ["tgsearchers3"],
    // plugins: ["jikepan"],
    // cloud_types: ["baidu", "quark", "aliyun"],
    // ext: { title_en: "English Title", is_all: true },
    // filter: { include: ["合集", "全集"], exclude: ["预告", "花絮"] },
};

const requestTimeout = 60000;
// 默认展示结果个数；用户也可以用 #pansou 关键词 -n 10 临时指定。
const defaultReplyLimit = 15;
// 单次最多展示多少条，避免误设太大导致合并转发过长。
const maxReplyLimit = 50;
const maxReplyLength = 3500;

export class PanSou extends plugin {
    constructor() {
        super({
            name: "[R插件补集] PanSou 网盘搜索",
            dsc: "使用 PanSou API 搜索网盘资源",
            event: "message",
            priority: 5000,
            rule: [
                {
                    reg: /^#pansou\s+[\s\S]+/i,
                    fnc: "search",
                },
            ],
        });

        this.baseURL = pansouBaseURL.replace(/\/+$/, "");
        this.staticToken = pansouToken.trim();
        this.token = "";
        this.tokenExpireAt = 0;
        this.http = axios.create({
            baseURL: this.baseURL,
            timeout: requestTimeout,
            httpsAgent: this.createHttpsAgent(),
            headers: {
                "Content-Type": "application/json",
                ...customHeaders,
            },
        });
    }

    async search(e) {
        const { kw, limit } = this.parseCommand(e.msg);

        if (!kw) {
            await e.reply("请输入搜索关键词，例如：#pansou 悟空，或 #pansou 悟空 -n 10");
            return false;
        }

        const waitMsg = await e.reply(`正在搜索：${kw}`, true);

        try {
            const data = await this.searchPanSou(kw);
            const forwardMessages = this.buildForwardMessages(e, kw, data, limit);
            await e.reply(Bot.makeForwardMsg(forwardMessages));
        } catch (error) {
            logger.error("[PanSou] 搜索失败：", error);
            await e.reply(`PanSou 搜索失败：${this.getErrorMessage(error)}`, true);
        } finally {
            await this.tryDeleteMsg(e, waitMsg);
        }

        return true;
    }

    createHttpsAgent() {
        const options = {
            rejectUnauthorized: tlsRejectUnauthorized,
        };

        if (tlsCaFile) {
            options.ca = fs.readFileSync(tlsCaFile);
            options.rejectUnauthorized = true;
        }

        return new https.Agent(options);
    }

    parseCommand(msg) {
        let text = String(msg || "")
            .replace(/^#pansou\s+/i, "")
            .trim();
        let limit = defaultReplyLimit;

        const limitPattern = /(?:^|\s)(-n|--limit|数量|条数)\s*(?:[:：=]\s*)?(\d+)(?=\s|$)/gi;
        text = text.replace(limitPattern, (match, option, value) => {
            limit = this.normalizeLimit(value);
            return "";
        }).replace(/\s+/g, " ").trim();

        return {
            kw: text,
            limit,
        };
    }

    normalizeLimit(value) {
        const num = Number.parseInt(value, 10);
        if (!Number.isFinite(num) || num <= 0) return defaultReplyLimit;
        return Math.min(num, maxReplyLimit);
    }

    normalizeResponseData(responseData) {
        if (responseData?.data && typeof responseData.data === "object") {
            return responseData.data;
        }
        return responseData || {};
    }

    buildForwardMessages(e, kw, responseData, limit = defaultReplyLimit) {
        const data = this.normalizeResponseData(responseData);
        const total = Number(data?.total || 0);
        const allItems = this.collectItems(data);
        const items = this.filterItems(allItems, kw);
        const displayLimit = this.normalizeLimit(limit);
        const sender = this.getForwardSender(e);

        if (items.length === 0) {
            const text = allItems.length > 0
                ? `PanSou 搜索：${kw}\n接口返回 ${allItems.length} 条，但没有包含搜索关键词的结果。`
                : total > 0
                    ? `PanSou 搜索：${kw}\n接口返回 ${total} 条，但没有可展示链接。`
                    : `PanSou 搜索：${kw}\n没有找到相关资源。`;
            return [this.makeForwardNode(sender, text)];
        }

        const messages = [
            this.makeForwardNode(
                sender,
                `PanSou 搜索：${kw}\n共找到 ${total || allItems.length} 条，按关键词过滤后 ${items.length} 条，展示前 ${Math.min(items.length, displayLimit)} 条。`
            ),
        ];

        for (let index = 0; index < Math.min(items.length, displayLimit); index += 1) {
            messages.push(this.makeForwardNode(sender, this.formatItem(items[index], index + 1).trim()));
        }

        if (items.length > displayLimit) {
            messages.push(this.makeForwardNode(sender, `结果较多，已截断 ${items.length - displayLimit} 条。可使用 #pansou 关键词 -n 数量 临时调整，或修改 defaultReplyLimit。`));
        }

        return messages;
    }

    filterItems(items, kw = "") {
        const keywords = this.parseFilterKeywords(kw);
        if (keywords.length === 0) return items;

        return items.filter(item => {
            const haystack = this.getFilterText(item);
            return keywords.every(word => haystack.includes(word));
        });
    }

    parseFilterKeywords(kw) {
        return String(kw || "")
            .split(/[\s,，、|]+/)
            .map(value => this.cleanText(value).toLowerCase())
            .filter(Boolean);
    }

    getFilterText(item) {
        return [
            item.diskType,
            item.title,
            item.url,
            item.password,
            item.source,
            item.datetime,
        ].map(value => this.cleanText(value).toLowerCase()).join(" ");
    }

    getForwardSender(e) {
        return {
            nickname: e.sender?.card || e.sender?.nickname || String(e.user_id || "PanSou"),
            user_id: e.user_id || e.self_id || 10000,
        };
    }

    makeForwardNode(sender, text) {
        return {
            message: {
                type: "text",
                text,
            },
            nickname: sender.nickname,
            user_id: sender.user_id,
        };
    }

    async searchPanSou(kw) {
        const headers = await this.buildAuthHeaders();
        const body = {
            ...defaultPostParams,
            kw,
        };

        const response = await this.http.post(searchPath, body, { headers });
        return response.data;
    }

    async buildAuthHeaders() {
        const token = await this.getToken();
        if (!token) return {};
        return {
            Authorization: `Bearer ${token}`,
        };
    }

    async getToken() {
        if (this.staticToken) return this.staticToken;
        if (!pansouUsername || !pansouPassword) return "";

        const now = Math.floor(Date.now() / 1000);
        if (this.token && this.tokenExpireAt - now > 60) {
            return this.token;
        }

        const response = await this.http.post(loginPath, {
            username: pansouUsername,
            password: pansouPassword,
        });

        const token = response.data?.token;
        if (!token) {
            throw new Error("登录成功但响应中没有 token");
        }

        this.token = token;
        this.tokenExpireAt = Number(response.data?.expires_at || 0);
        return this.token;
    }

    formatSearchResult(kw, responseData, limit = defaultReplyLimit) {
        const data = this.normalizeResponseData(responseData);
        const total = Number(data?.total || 0);
        const allItems = this.collectItems(data);
        const items = this.filterItems(allItems, kw);
        const displayLimit = this.normalizeLimit(limit);

        if (items.length === 0) {
            if (allItems.length > 0) {
                return `PanSou 搜索：${kw}\n接口返回 ${allItems.length} 条，但没有包含搜索关键词的结果。`;
            }
            const countText = total > 0 ? `接口返回 ${total} 条，但没有可展示链接。` : "没有找到相关资源。";
            return `PanSou 搜索：${kw}\n${countText}`;
        }

        const lines = [
            `PanSou 搜索：${kw}`,
            `共找到 ${total || allItems.length} 条，按关键词过滤后 ${items.length} 条，展示前 ${Math.min(items.length, displayLimit)} 条：`,
        ];
        let shown = 0;

        for (const item of items) {
            if (shown >= displayLimit) break;

            const block = this.formatItem(item, shown + 1);
            if ((lines.join("\n").length + block.length + 1) > maxReplyLength) {
                lines.push("剩余结果较多，已截断。可缩小关键词或调大 defaultReplyLimit/maxReplyLength。");
                break;
            }

            lines.push(block);
            shown += 1;
        }

        return lines.join("\n");
    }

    collectItems(data) {
        const mergedItems = this.collectMergedItems(data?.merged_by_type);
        if (mergedItems.length > 0) return mergedItems;

        const resultItems = this.collectResultItems(data?.results);
        if (resultItems.length > 0) return resultItems;

        return [];
    }

    collectMergedItems(mergedByType) {
        if (!mergedByType || typeof mergedByType !== "object") return [];

        const items = [];
        for (const [diskType, links] of Object.entries(mergedByType)) {
            if (!Array.isArray(links)) continue;

            for (const link of links) {
                if (!link?.url) continue;
                items.push({
                    diskType,
                    title: link.note || link.work_title || link.title || "",
                    url: link.url,
                    password: link.password || "",
                    source: link.source || "",
                    datetime: link.datetime || "",
                });
            }
        }

        return items;
    }

    collectResultItems(results) {
        if (!Array.isArray(results)) return [];

        const items = [];
        for (const result of results) {
            const links = Array.isArray(result?.links) ? result.links : [];
            for (const link of links) {
                if (!link?.url) continue;
                items.push({
                    diskType: link.type || "unknown",
                    title: link.work_title || result.title || "",
                    url: link.url,
                    password: link.password || "",
                    source: result.channel ? `tg:${result.channel}` : "",
                    datetime: link.datetime || result.datetime || "",
                });
            }
        }

        return items;
    }

    formatItem(item, index) {
        const lines = [
            "",
            `${index}. [${item.diskType || "unknown"}] ${this.cleanText(item.title) || "未命名资源"}`,
            `链接：${item.url}`,
        ];

        if (item.password) {
            lines.push(`提取码：${item.password}`);
        }
        if (item.source) {
            lines.push(`来源：${item.source}`);
        }
        if (item.datetime) {
            lines.push(`时间：${this.formatTime(item.datetime)}`);
        }

        return lines.join("\n");
    }

    cleanText(text) {
        return String(text || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 100);
    }

    formatTime(value) {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString("zh-CN", { hour12: false });
    }

    getErrorMessage(error) {
        const data = error?.response?.data;
        if (typeof data === "string") return data.slice(0, 200);
        if (data?.message) return String(data.message).slice(0, 200);
        if (data?.error) return String(data.error).slice(0, 200);
        if (error?.message) return String(error.message).slice(0, 200);
        return "未知错误";
    }

    async tryDeleteMsg(e, replyResult) {
        const messageId = replyResult?.data?.message_id;
        if (!messageId) return;

        try {
            await e.bot.sendApi("delete_msg", { message_id: messageId });
        } catch (error) {
            logger.debug?.("[PanSou] 删除临时消息失败：", error);
        }
    }
}
