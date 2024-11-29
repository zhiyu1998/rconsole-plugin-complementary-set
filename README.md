# R 插件轻量级补集

## 状态

- ✅ kimi.js 
- ✅ kimi2.js 
- ✅ check-car.js （由[Mix](https://github.com/MiX1024)提供）
- ✅ 谁艾特我
- ✅ 链接截图
- ✅ 使用http解决ncqq点赞插件
- ⚠️ 一些语音包（不稳定）
- ✅ GPT-SoVITS 接口适配
- ✅ NCQQ 3.4.6 以上快捷语音包
- ✅ 小秘书，反击at小助手
- ✅ LLama OCR
- ⚠️ Perplexity AI Proxy（🪜不好可能存在不稳定现象）
- ✅ 他们在聊什么？
- ✅ 多模态识别 - Gemini

## kimi.js 使用指南

1. 下载 / 更新 `kimi.js`
```shell
curl -fsSL https://gitee.com/kyrzy0416/rconsole-plugin-complementary-set/raw/master/kimi.js > plugins/rconsole-plugin/apps/kimi.js
```

2. 准备环境
如果没有安装 `Docker` 以及组件的话可以按照[文档](https://gitee.com/kyrzy0416/rconsole-plugin#%E5%BE%AE%E4%BF%A1%E6%96%87%E7%AB%A0%E6%80%BB%E7%BB%93-%E5%AE%8C%E5%85%A8%E5%85%8D%E8%B4%B9%E6%80%BB%E7%BB%93)进行安装，需要补充以下内容到`R插件`：
```yaml
aiBaseURL: '' # 用于识图的接口，kimi默认接口为：https://api.moonshot.cn，其他服务商自己填写
aiApiKey: '' # 用于识图的api key，kimi接口申请：https://platform.moonshot.cn/console/api-keys
aiModel: 'moonshot-v1-8k' # 模型，使用kimi不用填写，其他要填写
```

3. 直接使用，触发关键字（`#kimi`）即可

![img.png](img/img.webp)


## kimi2.js -- 图文版本

1. 下载 / 更新

```shell
curl -fsSL https://gitee.com/kyrzy0416/rconsole-plugin-complementary-set/raw/master/kimi2.js > plugins/rconsole-plugin/apps/kimi.js
```

2. 填写信息 && 安装依赖

```yaml
aiBaseURL: '' # 用于识图的接口，kimi默认接口为：https://api.moonshot.cn，其他服务商自己填写
aiApiKey: '' # 用于识图的api key，kimi接口申请：https://platform.moonshot.cn/console/api-keys
aiModel: 'moonshot-v1-8k' # 模型，使用kimi不用填写，其他要填写
```

```shell
pnpm add marked --filter=rconsole-plugin
```

3. 直接使用，触发关键字（`#kimi`）即可

![img.png](img/img5.webp)

## 验车（由[Mix](https://github.com/MiX1024)提供）

1. 下载 / 更新 `check-car.js`
```shell
curl -fsSL https://gitee.com/kyrzy0416/rconsole-plugin-complementary-set/raw/master/check-car.js > plugins/rconsole-plugin/apps/check-car.js
```

2. 到`https://whatslink.info/` 随便解析一个磁力，然后获取cookie:

3. 修改 `46` 行的 cookie：
```javascript
'Cookie': 'aliyungf_tc=xxx',
```

4. 使用示例：

![img.png](img/img2.webp)

## 谁艾特我

群里有时候要处理群友提出的 bug 就会找At 之前这个脚本没有进行排序, 要拉到最底下, 现在做了排序第一个就是最新的

```shell
curl -fsSL https://gitee.com/kyrzy0416/rconsole-plugin-complementary-set/raw/master/who-at-me.js > plugins/rconsole-plugin/apps/who-at-me.js
```

![img.png](img/img3.webp)

## 链接截图（群内小伙伴提的需求，说某插件的截图不好用）

- 随便发http开头就会截图
- #gittr 查看每日GitHub热榜

放到example即可

```shell
curl -fsSL https://gitee.com/kyrzy0416/rconsole-plugin-complementary-set/raw/master/screenshot.js > plugins/example/screenshot.js
```

![img.png](img/img4.webp)

## 使用http解决ncqq点赞插件

```shell
curl -fsSL https://gitee.com/kyrzy0416/rconsole-plugin-complementary-set/raw/master/thumbs-up.js > plugins/rconsole-plugin/apps/thumbs-up.js
```

## 语音包

1. 安装
```shell
curl -fsSL https://ghproxy.net/https://raw.githubusercontent.com/zhiyu1998/rconsole-plugin-complementary-set/main/deep-faker.js > plugins/example/deep-faker.js
```

2. 安装依赖
```shell
pnpm add form-data axios -w
```

3. 开始游玩

![img.png](img/img6.webp)

## GPT-SoVITS 接口适配

适配 [GPT-SoVITS-WebUI](https://github.com/RVC-Boss/GPT-SoVITS) 语音的小型插件

- 搭建 [GPT-SoVITS-WebUI](https://github.com/RVC-Boss/GPT-SoVITS)
- 搭建 [GPT-SoVITS 的api调用接口](https://github.com/jianchang512/gptsovits-api)

克隆到 `example`
```shell
curl -fsSL https://ghproxy.net/https://raw.githubusercontent.com/zhiyu1998/rconsole-plugin-complementary-set/main/gpt-sovits.js > plugins/example/gpt-sovits.js
```

1. 修改地址
```shell
const GPTSOVITS_HOST = "http://localhost:9880"
```

2. 修改人物，比如`丁真`
```shell
const voiceList = Object.freeze([
    "丁真",
])
```

3. 开始游玩
![img.png](img/img7.webp)

## NCQQ 3.4.6 以上快捷语音包

> ⚠️ 必须是 NCQQ 3.4.6 及以上才可以使用

克隆到 `example`
```shell
curl -fsSL https://ghproxy.net/https://raw.githubusercontent.com/zhiyu1998/rconsole-plugin-complementary-set/main/ncqq-ai-voice.js > plugins/example/ncqq-ai-voice.js
```

![img.png](img/img8.webp)

## 小秘书

1. 安装

```shell
curl -fsSL https://gitee.com/kyrzy0416/rconsole-plugin-complementary-set/raw/master/secretary.js > plugins/rconsole-plugin/apps/secretary.js
```

2. 在文件更改QQ号

```javascript
// TODO 这里需要修改你的QQ号
const masterId = "";
```

3. 开始使用

![img.png](img/img9.webp)

```shell
1. 小秘书切换状态
2. 小秘书TODO
3. 小秘书cls
```

切换到忙碌就会帮你反击at（前提你的机器人是管理员），然后做成todo统一处理

## LLama OCR

> 驱动自：https://github.com/Nutlope/llama-ocr
> 在线体验：https://llamaocr.com/

1. 安装依赖

```shell
pnpm add llama-ocr -w
```

2. 克隆单个文件到 R 插件 app 下：

```shell
curl -fsSL https://gitee.com/kyrzy0416/rconsole-plugin-complementary-set/raw/master/llama-ocr.js > plugins/rconsole-plugin/apps/llama-ocr.js
```

3. 到 [Together AI](https://www.together.ai/) 申请一个 Key，申请很快的，填入到 js 中

```shell
// https://www.together.ai/ 进行注册
const TOGETHER_API_KEY = "";
```

4. 启动，就可以免费体验 LLama AI 的 OCR

![PixPin_2024-11-25_22-05-13.png](https://s2.loli.net/2024/11/25/VBxj1Km5nrCXTls.png)

## Perplexity AI Proxy

> 驱动来自：https://github.com/Archeb/pplx-proxy
> 
> ⚠️ 已知问题：付费用户（已购买 pro）无法使用pro进行搜索，免费用户倒是不影响
> 
> 🔥 仅供个人部署用于访问自己合法取得的订阅，严禁用于转售或其他商业用途。不提供任何技术支持、不为任何违规使用导致的封号负责。

1. 搭建方法：

> https://github.com/Archeb/pplx-proxy/blob/main/usage.md

2. 克隆 js

```shell
curl -fsSL https://gitee.com/kyrzy0416/rconsole-plugin-complementary-set/raw/master/perplexity.js > plugins/example/perplexity.js
```

3. 使用 `#pplx` 就可以开始使用

## 他们在聊什么？

1. 安装到 R 插件

```shell
curl -fsSL https://gitee.com/kyrzy0416/rconsole-plugin-complementary-set/raw/master/whats-talk.js > plugins/rconsole-plugin/apps/whats-talk.js
```

2. 发送 `#他们在聊什么`

![PixPin_2024-11-26_14-11-38.png](https://s2.loli.net/2024/11/26/cnyeHf7T1iR2zSl.png)

## 多模态识别 - Gemini

1. 去 Google studio 获取一个 API Key

2. 克隆到 R 插件

```shell
curl -fsSL https://gitee.com/kyrzy0416/rconsole-plugin-complementary-set/raw/master/gemini.js > plugins/rconsole-plugin/apps/gemini.js
```

3. 填写 API Key

4. 安装 Gemini SDK

```shell
pnpm add @google/generative-ai -w
```

5. 启动，开始游玩

![PixPin_2024-11-29_19-56-34.png](https://s2.loli.net/2024/11/29/JED4gQmY3l6bLCF.png)

## 声明

* 素材来源于网络，仅供交流学习使用
* 严禁用于任何商业用途和非法行为
* 如果对你有帮助辛苦给个star，这是对我最大的鼓励
