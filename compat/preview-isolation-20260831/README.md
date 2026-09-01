# 作品来源隔离的本机比较材料

此目录不是生产补丁或上传包。只包含本地实验及其观察记录，未修改原 p5.js 或 C++ 应用，也未接触服务器。实施范围和下一步见 `../../docs/preview-isolation.md`。

在 Windows 项目目录运行：

```powershell
& 'D:\Program Files\nodejs\node.exe' 'compat\preview-isolation-20260831\local-lab.mjs' 'G:\teaching-p5js\frontend\public\libs\p5-1.11.13.min.js'
```

访问输出中的 mainOrigin，可比较四种方式。服务只绑定两个随机 127.0.0.1 端口，15 分钟后停止，也可用 Ctrl+C 结束。它读取指定的已存在 p5.js 库，不安装软件、不提供任意文件读取、不连接生产域名或数据库。

测试只让虚拟作品尝试读取父页面的公开虚拟 DOM 标记，并检查 Storage API 是否可用，没有读取或写入存储键值。素材仅为虚拟 SVG、JSON。结果记录在 evidence.json：四组嵌入式比较符合预期，严格沙箱的直接页面检查也完成；真实 Apache、HTTPS、音频、旧作品及坐标桥接尚未测试。
