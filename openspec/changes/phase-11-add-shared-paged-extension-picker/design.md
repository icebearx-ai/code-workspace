## Context

`@clack/prompts` 的 autocompleteMultiselect 支持搜索和多选，但其左右键用于输入光标，不支持把左右键绑定为分页。因此需要在 core browse session 之上提供一个小型终端状态机，而不是简单替换现有 multiselect。

## Goals / Non-Goals

**Goals:**

- 统一 init/search 的搜索、分页和多选体验。
- 列表焦点下左/右键翻页，搜索焦点下左右键编辑搜索词。
- 跨页保持选择，已禁用项不能被选中。
- 以可注入输入输出和 page provider 实现可测试交互。

**Non-Goals:**

- 不在 picker 内执行下载、Store 导入或 Workspace 写入。
- 不改变 Nexus page/session 服务。
- 不支持鼠标交互。

## Decisions

1. 采用两个明确焦点：`search` 和 `list`；Tab 在两者之间切换，Enter 在列表焦点提交，Esc 取消。
2. list 焦点键位：上下移动、Space 切换、左键 previous、右键 next；第一页/末页边界不循环。
3. 每一页只显示有限行，页眉显示 `第 N 页` 和是否存在下一页；加载期间保留旧页并显示 spinner/状态行。
4. 选择集合按 extension ID 存储，不按页存储；返回结果按首次选择/目录稳定顺序输出。
5. picker 接收标准化 `status`：`not-installed`、`installed-current`、`installed-outdated`、`unavailable`；current 和 unavailable 禁用，outdated 可选并返回 update action。

## Risks / Trade-offs

- [自定义终端状态机比 Clack 组件复杂] → 保持 picker 与 page provider 解耦，先覆盖按键 reducer，再做少量 PTY 集成测试。
- [用户不知道焦点在哪里] → 显示焦点提示和明确键位说明。
- [翻页时误触导致选择丢失] → 网络请求期间禁止切页键重复触发，成功后再更新页面；选择集合独立于页面缓存。

## Migration Plan

1. 新增 picker API 和纯状态 reducer。
2. 用 fake page provider 做键盘、跨页和禁用项测试。
3. 暂不接入业务命令；下一阶段分别接入 init 和 extension search。
