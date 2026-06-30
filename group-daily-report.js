import puppeteer from "../../packages/puppeteer/index.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdir, unlink } from "fs/promises";
import { createRequire } from "module";
import fs from "fs";
import yaml from "yaml";
const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ========== 配置 ==========
const HISTORY_COUNT = 2000;
// 定时推送的群组（留空则不推送）
const PUSH_CRON = "30 23 * * *";
const PUSH_GROUPS = [, ];
const AI_BASE_URL = "";
const AI_API_KEY = "";
const AI_MODEL = "";

// ========== 统计函数 ==========
function computeStats(messages, dayOffset = 0) {
    // 只保留指定日期的消息
    const now = new Date();
    const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
    const dayStart = targetDate.getTime() / 1000;
    const dayEnd = dayStart + 86400;
    const dayMessages = messages.filter(m => m.time >= dayStart && m.time < dayEnd);
    const stats = {
        total: 0,
        total: 0,
        users: new Set(),
        emojis: 0,
        chars: 0,
        hourly: new Array(24).fill(0),
        userMsgs: new Map(),
    };
    for (const msg of dayMessages) {
        const uid = msg?.sender?.user_id;
        const nickname = msg?.sender?.card || msg?.sender?.nickname || "未知";
        const msgList = Array.isArray(msg?.message) ? msg.message : [];
        const hour = new Date(msg.time * 1000).getHours();
        stats.total++;
        if (uid) stats.users.add(uid);
        stats.hourly[hour]++;
        if (uid && !stats.userMsgs.has(uid)) {
            stats.userMsgs.set(uid, { nickname, count: 0, texts: [] });
        }
        const u = stats.userMsgs.get(uid);
        if (u) u.count++;
        for (const seg of msgList) {
            if (seg?.type === "text" && seg?.data?.text) {
                const text = seg.data.text.trim();
                stats.chars += text.length;
                if (u && text) u.texts.push(text);
            }
            if (seg?.type === "face") stats.emojis++;
        }
    }
    let peakHour = 0, peakCount = 0;
    stats.hourly.forEach((c, h) => { if (c > peakCount) { peakHour = h; peakCount = c; } });
    stats.peakHour = peakHour;
    stats.peakCount = peakCount;
    stats.userCount = stats.users.size;
    // nickname → user_id 映射（用于头像）
    stats.nicknameToUid = new Map();
    for (const [uid, u] of stats.userMsgs) {
        stats.nicknameToUid.set(u.nickname, uid);
    }
    return { stats, dayMessages };
}

// ========== AI 分析 ==========
async function aiSummarize(chatText, stats, baseURL, apiKey, model) {
    const payload = {
        model,
        messages: [
            {
                role: "system",
                content:
                    "你是一个专业的群聊分析助手，擅长用轻松幽默的语气总结群聊。根据提供的群聊记录，完成以下任务：\n" +
                    "1. **今日话题**：提取 3-5 个主要话题，每个话题给出标题、参与群友和 2-3 句摘要。\n" +
                    "2. **群友画像**：为发言较多的 3-5 位群友生成个性标签和一句话描述。\n" +
                    "3. **群聊金句**：挑选 2-3 条最有意思/最经典的发言（保留原始内容和发言人）。\n" +
                    "4. **质量锐评**：用一段幽默的话点评群聊氛围和质量，给出 3-4 个分类标签（如「赛博拾荒」「技术扶贫」「抽象鉴赏」「生活奇谭」等）和占比百分比。\n\n" +
                    '严格按以下 JSON 格式输出，不要输出其他内容：\n```json\n{"topics":[{"title":"话题标题","members":["昵称1","昵称2"],"summary":"摘要"}],"portraits":[{"nickname":"昵称","tags":["标签1","标签2"],"desc":"描述"}],"quotes":[{"speaker":"昵称","content":"原话","aiComment":"锐评"}],"quality":{"tags":[{"name":"分类名","percent":30,"color":"orange","desc":"描述"}],"summary":"整体总结"}}\n```\n'
            },
            {
                role: "user",
                content: `群成员数：${stats.userCount}\n总消息数：${stats.total}\n\n聊天记录：\n${chatText}`
            }
        ],
        temperature: 0.7
    };
    const res = await fetch(baseURL + "/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(`AI 接口错误: ${result?.error?.message || res.statusText}`);
    const content = result?.choices?.[0]?.message?.content || "";
    const match = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI 返回格式无法解析");
    try { return JSON.parse(match[1] || match[0]); }
    catch { throw new Error("AI 返回 JSON 解析失败"); }
}

// ========== HTML 模板（手账便签风）==========
function buildHTML(stats, aiData, groupName, dayOffset = 0) {
    const now = new Date();
    const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
    const dateStr = targetDate.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-");

    // 柱状图
    const maxH = Math.max(...stats.hourly, 1);
    const barMaxH = 100;
    const peakHour = stats.peakHour;
    // 今天显示到当前小时，昨天/其他日期显示完整24小时
    const endHour = dayOffset === 0 ? new Date().getHours() + 1 : 24;
    const bars = stats.hourly.slice(0, endHour).map((c, h) => {
        const barH = Math.round((c / maxH) * barMaxH) || 2;
        let color = "#90CAF9";
        if (h === peakHour) color = "#FF8A65";
        else if (c > maxH * 0.6) color = "#A5D6A7"; // 较高浅绿
        else if (c > maxH * 0.3) color = "#90CAF9"; // 中等浅蓝
        else color = "#C8E6C9"; // 低浅绿
        return `<div class="bar-col">
            <div class="bar-num">${c || ""}</div>
            <div class="bar" style="height:${barH}px;background:${color}"></div>
            <div class="bar-label">${String(h).padStart(2, "0")}</div>
        </div>`;
    }).join("");

    // 话题
    const topicsHTML = (aiData.topics || []).map((t, i) => {
        const members = (t.members || []).join("、");
        return `<div class="topic-card">
            <div class="topic-head">
                <span class="topic-check">☑</span>
                <span class="topic-title">${t.title}</span>
                <span class="topic-num">#${String(i + 1).padStart(2, "0")}</span>
            </div>
            <div class="topic-members">👥 参与者：${members || "全体群友"}</div>
            <div class="topic-body">${t.summary}</div>
        </div>`;
    }).join("");

    // 群友画像
    const tagColors = [
        { bg: "#F3E5F5", text: "#9575CD" },
        { bg: "#E8F5E9", text: "#66BB6A" },
        { bg: "#E6F4FF", text: "#5A9BD4" },
        { bg: "#FFF1B8", text: "#D4A017" },
        { bg: "#FFE8E8", text: "#E57373" },
    ];
    const portraitsHTML = (aiData.portraits || []).map((p, i) => {
        const uid = stats.nicknameToUid.get(p.nickname) || "";
        const avatarUrl = uid ? `https://q1.qlogo.cn/g?b=qq&nk=${uid}&s=640` : "";
        const tags = (p.tags || []).map((tag, ti) => {
            const tc = tagColors[ti % tagColors.length];
            return `<span class="ptag" style="background:${tc.bg};color:${tc.text}">${tag}</span>`;
        }).join("");
        const rotate = (i % 2 === 0) ? "rotate(-1deg)" : "rotate(1deg)";
        const avatarInner = avatarUrl
            ? `<img class="portrait-avatar-img" src="${avatarUrl}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="portrait-avatar-fallback" style="display:none">${(p.nickname||"?")[0]}</div>`
            : `<div class="portrait-avatar-fallback">${(p.nickname||"?")[0]}</div>`;
        return `<div class="portrait-card" style="transform:${rotate}">
            <div class="portrait-top">
                <div class="portrait-avatar">${avatarInner}</div>
                <div class="portrait-info">
                    <div class="portrait-name">${p.nickname}</div>
                    <div class="portrait-tags">${tags}</div>
                </div>
            </div>
            <div class="portrait-desc">${p.desc}</div>
        </div>`;
    }).join("");

    // 金句
    const quoteBubbleColors = ["#FFF1B8", "#E6F4FF", "#F3E5F5"];
    const quotesHTML = (aiData.quotes || []).map((q, i) => {
        const bgColor = quoteBubbleColors[i % quoteBubbleColors.length];
        const aiComment = q.aiComment ? `<div class="quote-ai">🤖 AI锐评: ${q.aiComment}</div>` : "";
        const rotate = (i % 2 === 0) ? "rotate(-0.5deg)" : "rotate(0.5deg)";
        const quid = stats.nicknameToUid.get(q.speaker) || "";
        const qAvatarUrl = quid ? `https://q1.qlogo.cn/g?b=qq&nk=${quid}&s=640` : "";
        const qAvatarInner = qAvatarUrl
            ? `<img class="quote-avatar-img" src="${qAvatarUrl}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><span class="quote-avatar-fallback" style="display:none">${(q.speaker||"?")[0]}</span>`
            : `<span class="quote-avatar-fallback">${(q.speaker||"?")[0]}</span>`;
        return `<div class="quote-item" style="transform:${rotate}">
            <div class="quote-speaker">
                <span class="quote-avatar">${qAvatarInner}</span>
                <span class="quote-name">${q.speaker}</span>
            </div>
            <div class="quote-bubble" style="background:${bgColor}">"${q.content}"</div>
            ${aiComment}
        </div>`;
    }).join("");

    // 质量锐评
    const qualityTags = (aiData.quality?.tags || []).map(t => {
        const colorMap = {
            orange: { bg: "#FFF1B8", text: "#D4A017", bar: "#FF8A65" },
            red: { bg: "#FFE8E8", text: "#E57373", bar: "#EF5350" },
            purple: { bg: "#F3E5F5", text: "#9575CD", bar: "#AB47BC" },
            green: { bg: "#E8F5E9", text: "#66BB6A", bar: "#66BB6A" },
            blue: { bg: "#E6F4FF", text: "#5A9BD4", bar: "#42A5F5" },
        };
        const c = colorMap[t.color] || colorMap.blue;
        return `<div class="quality-tag">
            <div class="qt-header">
                <span class="qt-badge" style="background:${c.bg};color:${c.text}">${t.name}</span>
                <span class="qt-percent" style="color:${c.bar}">${t.percent}%</span>
            </div>
            <div class="qt-bar-bg"><div class="qt-bar" style="width:${t.percent}%;background:${c.bar}"></div></div>
            <div class="qt-desc">${t.desc}</div>
        </div>`;
    }).join("");

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    font-family: "Noto Sans SC", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    background-color: #F7F2EC;
    background-image: radial-gradient(#E8E2D9 1px, transparent 1px);
    background-size: 20px 20px;
    padding: 32px;
    width: 960px;
}

/* 外层大卡片 */
.card {
    background: #FFFFFF;
    border: 2.5px solid #F2B880;
    border-radius: 20px;
    padding: 36px;
    box-shadow: 0 8px 32px rgba(90,70,54,0.08);
}

/* ========== 1. 顶部标题区 ========== */
.title-box {
    border: 2px dashed #5A4636;
    border-radius: 8px;
    padding: 28px 32px;
    text-align: center;
    position: relative;
    transform: rotate(-0.8deg);
    margin-bottom: 28px;
    background: #FFFCF8;
}
.title-main {
    font-size: 28px;
    font-weight: 900;
    color: #5A4636;
    line-height: 1.5;
}
.title-date {
    position: absolute;
    top: 12px;
    right: 16px;
    background: #FFF1B8;
    color: #D4A017;
    padding: 4px 14px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 700;
    transform: rotate(2deg);
}
.title-group {
    font-size: 13px;
    color: #8A7968;
    margin-top: 6px;
}

/* ========== 2. 数据概览区 ========== */
.stats-section {
    display: flex;
    gap: 16px;
    margin-bottom: 24px;
}
.stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    flex: 1;
}
.stat-card {
    background: #FFFFFF;
    border: 1.5px solid #E5E0D8;
    border-radius: 12px;
    padding: 16px;
    text-align: center;
    transform: rotate(-0.5deg);
}
.stat-card:nth-child(2) { transform: rotate(0.5deg); }
.stat-card:nth-child(3) { transform: rotate(0.3deg); }
.stat-card:nth-child(4) { transform: rotate(-0.3deg); }
.stat-icon { font-size: 22px; margin-bottom: 4px; }
.stat-num { font-size: 28px; font-weight: 900; color: #5A4636; }
.stat-label { font-size: 13px; color: #8A7968; margin-top: 2px; }

.highlight-card {
    background: #FFF1B8;
    border: 2px dashed #D4A017;
    border-radius: 12px;
    padding: 20px;
    text-align: center;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    min-width: 200px;
    transform: rotate(0.8deg);
}
.hl-label { font-size: 12px; color: #D4A017; font-weight: 700; letter-spacing: 1px; }
.hl-time { font-size: 26px; font-weight: 900; color: #5A4636; margin: 6px 0; }
.hl-note { font-size: 12px; color: #8A7968; }

/* ========== 3. 24H 活跃轨迹 ========== */
.chart-box {
    border: 1.5px solid #E5E0D8;
    border-radius: 12px;
    padding: 20px 24px;
    margin-bottom: 24px;
    background: #FFFCF8;
}
.section-title {
    font-size: 18px;
    font-weight: 700;
    color: #5A4636;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
}
.section-title .icon { font-size: 20px; }
.chart-row {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 130px;
    padding-top: 8px;
}
.bar-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
}
.bar-num {
    font-size: 9px;
    color: #8A7968;
    margin-bottom: 2px;
    min-height: 12px;
}
.bar {
    width: 100%;
    border-radius: 4px 4px 0 0;
    min-height: 2px;
}
.bar-label {
    font-size: 10px;
    color: #8A7968;
    margin-top: 4px;
}

/* ========== 4. 今日话题 ========== */
.topics-section {
    margin-bottom: 24px;
}
.topic-card {
    border: 1.5px solid #E5E0D8;
    border-radius: 12px;
    padding: 16px 20px;
    margin-bottom: 12px;
    background: #FFFCF8;
    border-left: 4px solid #F2B880;
}
.topic-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
}
.topic-check { font-size: 16px; color: #66BB6A; }
.topic-title { font-size: 16px; font-weight: 700; color: #5A4636; }
.topic-num { font-size: 13px; font-weight: 700; color: #D4A017; margin-left: auto; }
.topic-members { font-size: 13px; color: #8A7968; margin-bottom: 6px; }
.topic-body { font-size: 14px; color: #5A4636; line-height: 1.7; }

/* ========== 5. 群友画像 ========== */
.portraits-section {
    margin-bottom: 24px;
}
.portraits-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
}
.portrait-card {
    border: 1.5px solid #E5E0D8;
    border-radius: 14px;
    padding: 18px;
    background: #FFFFFF;
    transition: transform 0.2s;
}
.portrait-top {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
}
.portrait-avatar {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    flex-shrink: 0;
    overflow: hidden;
    position: relative;
}
.portrait-avatar-img {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    object-fit: cover;
}
.portrait-avatar-fallback {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: linear-gradient(135deg, #F2B880, #FF8A65);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 900;
}
.portrait-name { font-size: 16px; font-weight: 700; color: #5A4636; }
.portrait-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
.ptag {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 500;
}
.portrait-desc { font-size: 14px; color: #8A7968; line-height: 1.6; }

/* ========== 6. 群聊金句 ========== */
.quotes-section {
    margin-bottom: 24px;
}
.quote-item {
    margin-bottom: 16px;
    padding: 0 8px;
}
.quote-speaker {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
}
.quote-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    flex-shrink: 0;
    overflow: hidden;
    position: relative;
    display: inline-flex;
}
.quote-avatar-img {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
}
.quote-avatar-fallback {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: linear-gradient(135deg, #AB47BC, #CE93D8);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 700;
}
.quote-name { font-size: 14px; font-weight: 700; color: #5A4636; }
.quote-bubble {
    border-radius: 14px 14px 14px 4px;
    padding: 12px 18px;
    font-size: 15px;
    color: #5A4636;
    line-height: 1.6;
    display: inline-block;
    max-width: 85%;
    box-shadow: 0 2px 8px rgba(90,70,54,0.06);
}
.quote-ai {
    margin-top: 6px;
    background: #F3E5F5;
    color: #9575CD;
    padding: 6px 14px;
    border-radius: 8px;
    font-size: 13px;
    display: inline-block;
    max-width: 85%;
}

/* ========== 7. 质量锐评 ========== */
.quality-section {
    margin-bottom: 24px;
}
.quality-box {
    border: 2px dashed #E5E0D8;
    border-radius: 12px;
    padding: 20px;
    background: #FFF9F0;
    position: relative;
}
.quality-tapes {
    display: flex;
    gap: 10px;
    margin-bottom: 16px;
}
.quality-tape {
    padding: 5px 16px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 700;
    color: white;
    transform: rotate(-2deg);
    box-shadow: 0 2px 6px rgba(0,0,0,0.1);
}
.quality-tape:nth-child(2) { transform: rotate(1.5deg); }
.qt-orange { background: #FF8A65; }
.qt-red { background: #EF5350; }
.quality-tag {
    margin-bottom: 14px;
}
.quality-tag:last-child { margin-bottom: 0; }
.qt-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 4px;
}
.qt-badge {
    padding: 3px 12px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
}
.qt-percent {
    font-size: 18px;
    font-weight: 900;
}
.qt-bar-bg {
    height: 6px;
    background: #E5E0D8;
    border-radius: 3px;
    margin-bottom: 4px;
    overflow: hidden;
}
.qt-bar {
    height: 100%;
    border-radius: 3px;
    transition: width 0.5s;
}
.qt-desc { font-size: 13px; color: #8A7968; }
.quality-summary {
    margin-top: 16px;
    padding: 14px 16px;
    background: #F3E5F5;
    border-radius: 10px;
    font-size: 14px;
    color: #5A4636;
    line-height: 1.7;
    display: flex;
    gap: 10px;
    align-items: flex-start;
}
.quality-summary .qs-icon { font-size: 20px; flex-shrink: 0; }

/* ========== 8. 底部信息栏 ========== */
.footer-row {
    display: flex;
    gap: 12px;
}
.footer-card {
    flex: 1;
    border-radius: 10px;
    padding: 14px 16px;
    font-size: 12px;
    line-height: 1.6;
}
.footer-yellow { background: #FFF1B8; color: #D4A017; }
.footer-blue { background: #E6F4FF; color: #5A9BD4; }
.footer-purple { background: #F3E5F5; color: #9575CD; }
.f-title { font-weight: 700; font-size: 13px; margin-bottom: 4px; }
</style>
</head>
<body>
<div class="card">

    <!-- 1. 标题区 -->
    <div class="title-box">
        <div class="title-date">${dateStr}</div>
        <div class="title-main">✨ 五彩斑斓的一天，来看看群里发生了什么吧！</div>
        <div class="title-group">${groupName || ""} · AI 自动生成</div>
    </div>

    <!-- 2. 数据概览 -->
    <div class="stats-section">
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon">💬</div>
                <div class="stat-num">${stats.total}</div>
                <div class="stat-label">消息总数</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">👥</div>
                <div class="stat-num">${stats.userCount}</div>
                <div class="stat-label">参与人数</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">😄</div>
                <div class="stat-num">${stats.emojis}</div>
                <div class="stat-label">表情统计</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">📝</div>
                <div class="stat-num">${stats.chars}</div>
                <div class="stat-label">总字符数</div>
            </div>
        </div>
        <div class="highlight-card">
            <div class="hl-label">🔥 HIGHLIGHT TIME</div>
            <div class="hl-time">${String(stats.peakHour).padStart(2, "0")}:00-${String((stats.peakHour + 1) % 24).padStart(2, "0")}:00</div>
            <div class="hl-note">此刻，世界色彩斑斓 🌈</div>
        </div>
    </div>

    <!-- 3. 24H 活跃轨迹 -->
    <div class="chart-box">
        <div class="section-title"><span class="icon">📊</span> 24H 活跃轨迹</div>
        <div class="chart-row">${bars}</div>
    </div>

    <!-- 4. 今日话题 -->
    <div class="topics-section">
        <div class="section-title"><span class="icon">💡</span> 今日话题 Topics</div>
        ${topicsHTML}
    </div>

    <!-- 5. 群友画像 -->
    <div class="portraits-section">
        <div class="section-title" style="justify-content:center"><span class="icon">🎭</span> 群友画像 Portraits</div>
        <div class="portraits-grid">${portraitsHTML}</div>
    </div>

    <!-- 6. 群聊金句 -->
    <div class="quotes-section">
        <div class="section-title"><span class="icon">💎</span> 群贤毕至 Quotes</div>
        ${quotesHTML}
    </div>

    <!-- 7. 质量锐评 -->
    <div class="quality-section">
        <div class="section-title"><span class="icon">⚡</span> 群聊质量锐评</div>
        <div class="quality-box">
            <div class="quality-tapes">
                <span class="quality-tape qt-orange">赛博流浪汉互助指南</span>
                <span class="quality-tape qt-red">除了正事，我们什么都聊</span>
            </div>
            ${qualityTags}
            <div class="quality-summary">
                <span class="qs-icon">🧑‍🎨</span>
                <span>${aiData.quality?.summary || "一群有趣的人在一起，总能碰撞出奇妙的火花。"}</span>
            </div>
        </div>
    </div>

    <!-- 8. 底部 -->
    <div class="footer-row">
        <div class="footer-card footer-yellow">
            <div class="f-title">📋 Group Daily Report</div>
            ${dateStr}<br>${groupName || ""}
        </div>
        <div class="footer-card footer-blue">
            <div class="f-title">🔗 Powered by</div>
            Orangezai Bot<br>Playwright Render
        </div>
        <div class="footer-card footer-purple">
            <div class="f-title">🤖 AI Token</div>
            Model: ${AI_MODEL || "auto"}<br>${stats.total} msgs analyzed
        </div>
    </div>

</div>
</body>
</html>`;
}

// ========== 渲染截图 ==========
async function renderToImage(html, outputPath) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 960, height: 800, deviceScaleFactor: 2 });
        await page.setContent(html, { waitUntil: "networkidle", timeout: 30000 });
        await page.evaluate(() => document.fonts?.ready);
        await new Promise(r => setTimeout(r, 500));
        const height = await page.evaluate(() => document.body.scrollHeight);
        await page.setViewport({ width: 960, height: height + 40, deviceScaleFactor: 2 });
        await page.screenshot({ path: outputPath, type: "png", fullPage: true });
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

// ========== 主插件 ==========
export class GroupDailyReport extends plugin {
    constructor() {
        super({
            name: "群聊日报",
            dsc: "生成手账便签风群聊日报长图",
            event: "message",
            priority: 5000,
            rule: [
                {
                    reg: "^#群聊日报$",
                    fnc: "generateReport"
                },
                {
                    reg: "^#群聊昨日报$",
                    fnc: "generateYesterdayReport"
                }
            ]
        });

        this.task = {
            cron: PUSH_CRON,
            name: "群聊日报定时推送",
            fnc: () => this.pushReport(),
            log: false
        };

        this.toolsConfig = null;
        try {
            const configPath = join(process.cwd(), "plugins/rconsole-plugin/config/tools.yaml");
            const raw = fs.readFileSync(configPath, "utf-8");
            this.toolsConfig = yaml.parse(raw) || {};
        } catch (e) {
            logger.warn("[群聊日报] 加载 tools.yaml 失败:", e.message);
            this.toolsConfig = {};
        }
    }

    getConfig() {
        return {
            baseURL: AI_BASE_URL || this.toolsConfig?.aiBaseURL || "",
            apiKey: AI_API_KEY || this.toolsConfig?.aiApiKey || "",
            model: AI_MODEL || this.toolsConfig?.aiModel || "",
        };
    }

    async generateReport(e, dayOffset = 0) {
        try {
            const dayLabel = dayOffset === 0 ? "今日" : "昨日";
            await e.reply(`📊 正在生成群聊${dayLabel}报，请稍候...`);

            const data = await Bot.sendApi("get_group_msg_history", {
                group_id: e.group_id,
                count: HISTORY_COUNT
            });
            const messages = data?.data?.messages || [];

            const { stats, dayMessages } = computeStats(messages, dayOffset);

            if (dayMessages.length < 5) {
                await e.reply("消息太少啦，多聊会儿再来吧~");
                return;
            }

            // 构造聊天文本
            const chatLines = dayMessages.map(msg => {
                const card = msg?.sender?.card || msg?.sender?.nickname || "未知";
                const msgList = Array.isArray(msg?.message) ? msg.message : [];
                return msgList
                    .filter(s => s?.type === "text" && s?.data?.text)
                    .map(s => `${card}: ${s.data.text.trim()}`)
                    .filter(Boolean).join("\n");
            }).filter(Boolean).join("\n");

            const maxLen = 15000;
            const chatText = chatLines.length > maxLen ? chatLines.slice(-maxLen) : chatLines;

            // AI 分析
            const cfg = this.getConfig();
            let aiData = { topics: [], portraits: [], quotes: [], quality: { tags: [], summary: "" } };
            if (cfg.baseURL && cfg.apiKey) {
                try {
                    aiData = await aiSummarize(chatText, stats, cfg.baseURL, cfg.apiKey, cfg.model);
                } catch (err) {
                    logger.error("[群聊日报] AI 分析失败:", err.message);
                }
            }

            // 群名
            let groupName = "群聊日报";
            try {
                const gInfo = await Bot.sendApi("get_group_info", { group_id: e.group_id });
                groupName = gInfo?.data?.group_name || groupName;
            } catch {}

            // 渲染
            const ts = Date.now();
            const outputPath = join(__dirname, `../temp/group-daily-${ts}.png`);
            await mkdir(dirname(outputPath), { recursive: true });
            const html = buildHTML(stats, aiData, groupName, dayOffset);
            await renderToImage(html, outputPath);

            await e.reply(segment.image(outputPath));
            await unlink(outputPath).catch(() => {});
            logger.info(`[群聊${dayLabel}报] 完成: ${stats.total}条, ${stats.userCount}人`);
        } catch (err) {
            logger.error("[群聊日报] 生成失败:", err);
            await e.reply(`日报生成失败：${err.message || err}`);
        }
    }

    // ========== 昨日报 ==========
    async generateYesterdayReport(e) {
        return this.generateReport(e, -1);
    }

    // ========== 定时推送 ==========
    async pushReport() {
        if (!PUSH_GROUPS.length) return;

        for (const gid of PUSH_GROUPS) {
            try {
                // 拉取消息
                const data = await Bot.sendApi("get_group_msg_history", {
                    group_id: gid,
                    count: HISTORY_COUNT
                });
                const messages = data?.data?.messages || [];

                const { stats, dayMessages } = computeStats(messages);

                if (dayMessages.length < 5) {
                    logger.info(`[群聊日报] 群 ${gid} 今日消息不足，跳过`);
                    continue;
                }

                // 构造聊天文本
                const chatLines = dayMessages.map(msg => {
                    const card = msg?.sender?.card || msg?.sender?.nickname || "未知";
                    const msgList = Array.isArray(msg?.message) ? msg.message : [];
                    return msgList
                        .filter(s => s?.type === "text" && s?.data?.text)
                        .map(s => `${card}: ${s.data.text.trim()}`)
                        .filter(Boolean).join("\n");
                }).filter(Boolean).join("\n");
                const chatText = chatLines.length > 15000 ? chatLines.slice(-15000) : chatLines;

                // AI 分析
                const cfg = this.getConfig();
                let aiData = { topics: [], portraits: [], quotes: [], quality: { tags: [], summary: "" } };
                if (cfg.baseURL && cfg.apiKey) {
                    try {
                        aiData = await aiSummarize(chatText, stats, cfg.baseURL, cfg.apiKey, cfg.model);
                    } catch (err) {
                        logger.error("[群聊日报] AI 分析失败:", err.message);
                    }
                }

                // 群名
                let groupName = "群聊日报";
                try {
                    const gInfo = await Bot.sendApi("get_group_info", { group_id: gid });
                    groupName = gInfo?.data?.group_name || groupName;
                } catch {}

                // 渲染
                const ts = Date.now();
                const outputPath = join(__dirname, `../temp/group-daily-${ts}.png`);
                await mkdir(dirname(outputPath), { recursive: true });
                const html = buildHTML(stats, aiData, groupName, 0);
                await renderToImage(html, outputPath);

                // 发送
                await Bot.pickGroup(gid).sendMsg(segment.image(outputPath));
                await unlink(outputPath).catch(() => {});
                logger.info(`[群聊日报] 群 ${gid} 推送完成: ${stats.total}条`);
                await new Promise(r => setTimeout(r, 2000));
            } catch (err) {
                logger.error(`[群聊日报] 群 ${gid} 推送失败:`, err);
            }
        }
    }
}
