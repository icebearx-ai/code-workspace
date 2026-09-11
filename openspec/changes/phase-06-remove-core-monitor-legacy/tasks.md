## 1. Removal Gates

- [ ] 1.1 验证 Monitor 扩展已成为默认路径并完成至少一个兼容发布周期。
- [ ] 1.2 汇总无阻断迁移、业务对等、回滚手册、旧命令使用和公共 API deprecation 证据。
- [ ] 1.3 确定破坏性版本、发布说明和用户迁移路径。
- [ ] 1.4 若任一门槛不满足，停止实施并保留现有核心 Legacy。

## 2. Staged Core Removal

- [ ] 2.1 移除旧 `code-w monitor` 路由和兼容别名注册，保留明确迁移错误或版本说明。
- [ ] 2.2 移除旧 Monitor managed Hook 和核心 capability 选择逻辑。
- [ ] 2.3 移除核心 `config.monitor` 域、投影、渲染、迁移和诊断代码。
- [ ] 2.4 移除 `src/monitor`、公共导出桥接、打包资源和 `dev:monitor` 旧脚本。
- [ ] 2.5 保留扩展配置、扩展状态、用户 Hook 和 Monitor 运行期用户数据。

## 3. Documentation and Packaging

- [ ] 3.1 更新 README、CLI 架构、配置和扩展文档，只保留扩展路径。
- [ ] 3.2 更新 package files、exports、bin 和发布检查，确保无悬空引用。
- [ ] 3.3 提供旧公共 API 的最终迁移说明和可搜索错误。
- [ ] 3.4 验证删除核心实现不改变扩展版 Monitor 的 Session 业务规则。

## 4. Verification

- [ ] 4.1 按删除面分别运行针对性测试和回滚演练。
- [ ] 4.2 覆盖旧配置、旧命令、旧公共 API 和用户数据保留场景。
- [ ] 4.3 运行完整测试、CLI architecture checker、OpenSpec validate 和 package dry-run。
- [ ] 4.4 完成发布前检查，确认删除操作未修改任何用户 Workspace 数据。
