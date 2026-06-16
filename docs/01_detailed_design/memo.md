用万能旅行拍照姿势美美出片
根据上述话题生成内容素材
素材字段如下
```json
{
"research": {
"keywords": [],
"articles": [],
"images": [],
"videos": [],
"core_points": [],
"writing_angles": []
}
}
```

openclaw-control-ui
18:24
📋
```json
{
  "research": {
    "keywords": [
      "旅行拍照姿势",
      "旅游摄影技巧",
      "拍照好看",
      "旅行穿搭拍照",
      "自然拍照姿势",
      "网红拍照姿势",
      "手机旅行摄影",
      "旅行大片",
      "出片率高",
      "不尴尬拍照",
      "旅行姿势大全",
      "旅行摄影教程"
    ],
    "articles": [
      "2026年最流行的旅行拍照姿势",
      "如何避免旅行照僵硬不自然？",
      "手机也能拍出旅行大片：构图与姿势解析",
      "旅行穿搭与拍照姿势的完美搭配",
      "不同场景下的万能拍照姿势（海边、城市、山林）",
      "一个人旅行如何拍出精彩照片"
    ],
    "images": [
      "各种旅行场景下的pose示范图（正面、侧面、背面、回眸）",
      "情侣/闺蜜旅行合照姿势",
      "利用道具（帽子、丝巾、咖啡杯）的拍照姿势",
      "自然抓拍瞬间（走路、回头、与背景互动）",
      "不同构图方式下的姿势范例（三分法、对称构图）"
    ],
    "videos": [
      "5分钟学会万能旅行拍照姿势",
      "旅行摄影师教你拍出高级感大片",
      "手机旅行拍照姿势教学与实拍",
      "如何在旅行中自然摆Pose不尴尬",
      "网红打卡地拍照姿势指南"
    ],
    "core_points": [
      "姿势选择：侧身、回眸、不看镜头、利用道具、与景物互动、走路抓拍。",
      "自然感：避免僵硬，放松身体，笑容真实。",
      "构图技巧：善用三分法、前景、背景，突出人物与环境的融合。",
      "服装搭配：选择与旅行目的地风格协调的服装，增加画面美感。",
      "光线运用：利用自然光线，避免逆光或顶光造成面部阴影。",
      "表情管理：多尝试不同表情，展现自信与喜悦。",
      "互动性：与当地文化、建筑、美食等进行互动，增加照片故事性。"
    ],
    "writing_angles": [
      "教程类：分步骤教学万能拍照姿势，附带图文示范。",
      "清单类：总结N个旅行拍照必备姿势，方便读者收藏。",
      "场景类：针对不同旅行场景（海边、城市、自然风光）推荐专属姿势。",
      "避坑指南：分享旅行拍照常犯错误及如何避免。",
      "时尚穿搭类：结合流行穿搭，推荐适合拍照的服装和姿势。",
      "进阶技巧：从光线、构图、表情等多维度提升旅行照质量。"
    ]
  }
}
```


你这份 research 现在还只是AI生成的检索方向，不是二次采集结果。

下一步要做的是：

把 keywords / articles / images / videos
变成真实搜索 query
↓
去搜索引擎/API 检索
↓
拿到真实 url、标题、摘要、图片链接、视频链接
↓
写回 enriched_research
一、先把结构拆成 4 类检索
articles → 搜文章
images   → 搜图片参考
videos   → 搜视频参考
keywords → 扩展搜索词

你现在不要直接把这些当结果，要当作：

search_queries
二、推荐二次采集流程
1. 读取 research.keywords
2. 生成搜索 query
3. 调用搜索 API / 爬虫
4. 结果去重
5. 按相关度评分
6. 写入 enriched_research
三、文章检索怎么做

从你的内容里生成这些 query（IT 向示例）：

[
  "Apple M5 macOS kernel memory corruption exploit",
  "macOS 内核 内存破坏 漏洞 安全研究",
  "Apple Silicon kernel security disclosure",
  "HN macOS kernel exploit discussion",
  "macOS security update advisory",
  "内核漏洞 对开发者 影响"
]

采集目标：

{
  "title": "文章标题",
  "url": "文章链接",
  "snippet": "搜索摘要",
  "source": "google/bing/zhihu/hackernews/official_blog",
  "score": 0
}
四、图片检索怎么做

图片不要用文章里的长句，要转成视觉关键词。

推荐 query（IT 向示例）：

[
  "cybersecurity terminal dark theme",
  "kernel architecture diagram abstract",
  "Apple Silicon chip technology",
  "developer laptop security lock",
  "software vulnerability infographic",
  "tech conference keynote stage"
]

采集目标：

{
  "title": "图片标题",
  "image_url": "图片地址",
  "source_url": "来源页面",
  "source": "unsplash/pexels/google",
  "usage": "参考构图/信息结构/科技视觉风格",
  "local_path": ""
}

注意：图片建议只做参考图，不要直接拿去发布。发布图最好 AI 重新生成。

五、视频检索怎么做

推荐 query（IT 向示例）：

[
  "macOS kernel security explained",
  "Apple security update 说明",
  "kernel exploit 科普 开发者",
  "cybersecurity news breakdown",
  "HN security story explained"
]

采集目标：

{
  "title": "视频标题",
  "url": "视频链接",
  "thumbnail": "封面图",
  "duration": "",
  "source": "youtube/bilibili/official_channel",
  "summary": ""
}
六、建议写回的新结构

不要覆盖原来的 research，新增：

{
  "enriched_research": {
    "status": "done",
    "queries": {
      "articles": [],
      "images": [],
      "videos": []
    },
    "article_results": [],
    "image_results": [],
    "video_results": [],
    "selected_materials": {
      "articles": [],
      "images": [],
      "videos": []
    }
  }
}

Step 1：生成 query
const articleQueries = [
  ...research.keywords.slice(0, 5),
  ...research.articles.slice(0, 3)
];

const imageQueries = [
  "cybersecurity terminal dark",
  "kernel architecture diagram",
  "Apple Silicon technology",
  "developer security workflow"
];

const videoQueries = [
  "macOS kernel security explained",
  "kernel vulnerability 科普",
  "cybersecurity news breakdown"
];
Step 2：调用搜索源

推荐第一版：

文章：Bing Search API / SerpAPI / Google Custom Search
图片：Pexels API / Unsplash API
视频：YouTube Data API / B站搜索
Step 3：统一结果
{
  "type": "article",
  "query": "macOS kernel security exploit",
  "title": "",
  "url": "",
  "snippet": "",
  "source": "",
  "relevance_score": 0
}
八、筛选规则

二次采集后不要全塞给 AI，先筛选。

推荐规则：

文章保留 5-8 条
图片保留 6-10 张
视频保留 3-5 个

评分依据：

标题是否包含关键词
摘要是否和核心主题一致
来源是否可靠
是否适合生成内容
是否有图片/封面
是否重复
九、最终给文案生成用的内容

不要把所有原始结果都给文案模型。

给它这个：

{
  "content_brief": {
    "topic": "Apple M5 macOS kernel memory corruption exploit",
    "core_points": [],
    "writing_angles": [],
    "article_summaries": [],
    "visual_direction": [
      "深色终端与安全研究氛围",
      "内核/架构示意图（抽象）",
      "时间线信息图",
      "克制标题卡，避免未核实数据",
      "科技封面：芯片 + 安全元素"
    ],
    "video_reference_points": []
  }
}
十、一句话总结

你现在这份 JSON 是：

检索计划

下一步要做：

用它生成搜索 query
↓
去文章/图片/视频平台搜索
↓
拿真实链接和摘要
↓
筛选成 selected_materials
↓
再给 AI 生成文案和图片 prompt