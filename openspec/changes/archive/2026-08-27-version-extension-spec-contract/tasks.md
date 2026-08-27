## 1. 公共规范与 Schema

- [x] 1.1 新增 Extension Spec v1 中文规范文档并声明其组件 schema、输出和生命周期集合
- [x] 1.2 新增 manifest schema v3，使用 `extensionSpecVersion` 并移除 `codeWorkspace`
- [x] 1.3 更新 init context/result schema，使其回显 Extension Spec 版本

## 2. Host 兼容性与发现

- [x] 2.1 声明 Host 支持的 Extension Spec 版本集合并提供明确的支持判断
- [x] 2.2 重构 manifest envelope/完整校验，移除产品版本范围解析
- [x] 2.3 按受支持规范选择最高扩展 SemVer，并为无支持实现返回稳定诊断
- [x] 2.4 在计划、context/result 验证和执行前 stale 校验中贯穿规范版本

## 3. 状态与生命周期

- [x] 3.1 新 installed protocol v3 记录 `extensionSpecVersion` 并验证完整后置条件
- [x] 3.2 保留 installed protocol v1/v2 的读取、漂移检查和安全卸载能力
- [x] 3.3 失败尝试和结构化执行结果记录适用的 Extension Spec 版本

## 4. 内置扩展与交互

- [x] 4.1 将 OpenSpec Workspace 和 Zhuiyi Jira MCP manifest/入口迁移到 Extension Spec v1
- [x] 4.2 更新 init 与 extension install 的展示和诊断，保持现有 CLI contract 不变

## 5. 文档与验证

- [x] 5.1 更新中英文扩展文档和架构文档，移除产品版本兼容声明
- [x] 5.2 更新单元与 CLI 测试，覆盖混合规范选择、未知规范、context/result、installed v3 和旧状态卸载
- [x] 5.3 运行 OpenSpec strict validate、CLI 架构检查、完整测试、diff check 和打包检查
- [x] 5.4 将 Extension Spec v1 迁移到 `spec/extension/v1`，补强规范性声明并更新全部引用和发布清单
- [x] 5.5 重新运行 OpenSpec strict validate、完整检查、diff check 和打包内容检查
- [x] 5.6 提供完整英文 Extension Spec v1，在中英文规范间增加双向语言切换并更新引用
- [x] 5.7 重新验证双语规范、OpenSpec、完整测试、diff 和 npm 打包内容
