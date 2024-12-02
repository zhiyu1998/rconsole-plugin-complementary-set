from crawl4ai import AsyncWebCrawler, CacheMode, CrawlResult
from flask import Flask, request

app = Flask(__name__)


async def simple_crawl(url: str) -> CrawlResult:
    async with AsyncWebCrawler(verbose=True) as crawler:
        result = await crawler.arun(
            url=url,
            cach_mode=CacheMode.ENABLED,
        )
        return result


@app.get("/crawl")
async def read_root():
    url = request.args.get('url', default=None, type=str)
    crawl_res = await simple_crawl(url)
    resp = crawl_res.markdown_v2.raw_markdown
    return {
        "data": resp
    }

if __name__ == '__main__':
    app.run(debug=True)
