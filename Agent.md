# Agent Instructions

- 开发过程中的交流、设计文档、实现计划、变更说明和注释性说明文档默认使用中文。
- 即使外部技能模板使用英文，仓库内设计文档和实现计划也必须改写为中文。
- 面向最终用户的产品产物默认使用英文，包括 CLI help、CLI 错误/提示文案、README、命令示例说明和发布说明。
- PR 标题和 commit message 使用 Conventional Commits / Angular 风格，例如 `feat: add project-aware run tasks`。
- 功能分支整理提交后，合回 `master` 默认使用 rebase 方式：先基于最新 `master` rebase 功能分支，再快进 `master` 并 push。
- 使用 `superpowers:brainstorming` 时，写完设计文档后必须暂停，等待用户明确 review/确认，不能直接写实现计划或改代码。
- 使用 `superpowers:writing-plans` 时，写完实现计划后必须暂停，等待用户明确确认，不能直接进入实现。
- 除非用户明确说“继续实现”“开干”“按计划执行”等，否则不要跨越设计、计划、实现之间的阶段门禁。
- 代码标识符、命令、配置键、错误输出示例或外部 API 名称按其原始语言保留。
- 正式设计文档避免写调研来源或已排除方案，聚焦最终设计。
