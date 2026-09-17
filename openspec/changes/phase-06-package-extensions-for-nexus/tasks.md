## 1. 分发合同与依赖

- [x] 1.1 定义并发布 npm 运输 envelope schema、固定 `@codew-ext/<id>` 映射和 `package/extension/` 布局常量
- [x] 1.2 评估并引入受维护的 tar/gzip 依赖，记录许可证、版本和文件类型/资源限制
- [x] 1.3 从现有扩展发现实现中提取不执行代码的 manifest、入口和目录验证公共 API

## 2. Core 打包与验证

- [x] 2.1 实现源扩展冻结、身份映射和不含 dependencies/scripts 的运输 `package.json` 生成
- [x] 2.2 实现稳定排序、普通文件限定、大小限制和 `package/` 前缀的流式 tarball 创建
- [x] 2.3 实现 tarball 重新读取、运输 envelope 校验和 `extension/` package digest 后置验证
- [x] 2.4 实现临时文件、原子 rename、已存在目标拒绝和失败清理
- [x] 2.5 返回 npm integrity、manifest/entry/package digest 和最终 tarball 路径的稳定 core 结果

## 3. `extension pack` CLI

- [x] 3.1 在 CLI registry 声明 `extension pack <source> --output <directory>` 的 Workspace、参数、interaction 和 effects 合同
- [x] 3.2 在 extension 命令模块中仅编排 core pack API、共享结果与稳定错误，不直接读写原始文件
- [x] 3.3 更新 help、completion 和中英文使用文档中的打包命令与 Nexus CI 示例
- [x] 3.4 扩展 CLI 架构检查，覆盖命令分层、原子输出、后置验证和回滚要求

## 4. 内置扩展与发布准备

- [x] 4.1 对每个普通内置扩展生成 tarball，并验证解包后的 packageSha256 与原目录一致
- [x] 4.2 明确系统扩展的发布排除策略，确保通用包格式不产生系统专用分支
- [x] 4.3 增加 CI pack smoke job 和 tarball 文件清单检查，但不在本 Change 自动执行 `npm publish`

## 5. 测试与验收

- [x] 5.1 覆盖 name/version/spec 不一致、缺失入口、摘要错误和不受支持规范
- [x] 5.2 覆盖路径逃逸、符号链接、硬链接、特殊文件、重复路径、文件数与大小超限
- [x] 5.3 覆盖已存在目标、写入/rename/重新验证失败后的文件系统状态和 JSON 诊断
- [x] 5.4 运行 CLI architecture checker、完整测试、pack dry-run 与项目 check，并验证文档命令可由真实 parser 识别
