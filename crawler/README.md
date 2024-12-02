## Gemini 联网搜索部署方式

1. 在你的服务器上创建一个文件夹 && 放入 py 文件

```shell
cd /home && mkdir crawler && cd crawler && curl -o https://gitee.com/kyrzy0416/rconsole-plugin-complementary-set/raw/master/crawler/crawl.py
```

2. 安装依赖

`[可选]` 创建一个虚拟环境：
```shell
python3 -m venv venv
source venv/bin/activate
```

`[必须]` 安装依赖
```shell
pip install flask[async]
pip install crawl4ai
crawl4ai-setup # Setup the browser
```

`[可选]` 如果还不能启动就安装下：
```shell
playwright install-deps
```

3. 挂到后台，目前展示 `tmux` 的挂载方式

```shell
tmux new -s craw
# 进入后
flask --app crawl run --host=0.0.0.0
```

4. 拉取最新的 `gemini-base64.js`，并填入你的 ip 地址，例如：`http://localhost:5000`

> [!NOTE]
> ⚠️ 这里注意最后不要加入`/`

```javascript
// 填写你的LLM Crawl 服务器地址，填写后即启用，例如：http://localhost:5000
const llmCrawlBaseUrl = "http://localhost:5000";
```

