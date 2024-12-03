from crawl4ai import AsyncWebCrawler, CacheMode, CrawlResult
from crawl4ai.content_filter_strategy import BM25ContentFilter
from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator
from flask import Flask, request

app = Flask(__name__)


async def simple_crawl(url: str) -> CrawlResult:
    async with AsyncWebCrawler(verbose=True) as crawler:
        result = await crawler.arun(
            url=url,
            cach_mode=CacheMode.ENABLED,
            markdown_generator=DefaultMarkdownGenerator(
                content_filter=BM25ContentFilter(user_query=None, bm25_threshold=1.0)
            ),
            exclude_external_images=True,
            excluded_tags=['form', 'nav']
        )
        return result


@app.get("/crawl")
async def read_root():
    url = request.args.get('url', default=None, type=str)
    crawl_res = await simple_crawl(url)
    resp = crawl_res.markdown_v2
    if resp is None:
        return {
            "data": "No data"
        }
    return {
        "data": resp.raw_markdown
    }

if __name__ == '__main__':
    app.run(debug=True)
