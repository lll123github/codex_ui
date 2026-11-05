# ReClaude 网页重新认证

在 `CODEX_WEB_CLAUDE_CONFIG` 指向的服务端配置中，设置 CLI 本体的绝对路径 `reclaudeExecutable`。它与启动 Claude Code 的进程包装器 `executable` 是两个入口：

```json
{
  "home": "/home/service",
  "executable": "/opt/account-pool/bin/claude-launch-reclaude",
  "reclaudeExecutable": "/opt/reclaude/reclaude",
  "storageDirectory": "/var/lib/account-pool/reclaude",
  "sharedUsers": {
    "workspaceDirectory": "/srv/account-pool/users",
    "orgIds": ["12345"]
  }
}
```

账号额度面板中的「重新认证 ReClaude」打开认证对话框。选择账号后点击「退出并重新登录」，网页会打开认证窗口，再把该窗口导航到客户端返回的 ReClaude 设备批准页。浏览器拦截弹窗时可点击「打开认证页面」。认证链接仅向本次操作的发起用户展示；所有正常登录的网页用户均可发起共享账号的认证。

后台执行 `scripts/reclaude-reauth.mjs`，始终向 `logout` 和 `login` 传入 `--org`。客户端提示本地绑定已移除时，改用同一组织的 `org bind` 完成设备流程。客户端必须支持按组织退出；不支持时操作失败，不降级为退出全部组织。脚本的标准输出只包含状态事件及验证过的认证链接，不转发客户端原始输出或凭据。独立运行示例：

认证链接允许 `reclaude.ai` 和当前客户端使用的 `www.recode.cat`，均要求 HTTPS、`/cli/auth` 路径和有效 `state`。浏览器启动器即使丢弃标准输出，脚本也通过临时私有文件接收链接；操作结束即删除该目录。

```sh
node scripts/reclaude-reauth.mjs --client /opt/reclaude/reclaude --home /home/service --org 12345
```

网页管理器在 CLI 外层协调共享机器的操作：同一 HOME 下的后端通过独占认证锁与运行租约互斥。Claude 任务执行或迁移期间无法重新认证，认证期间暂停新 Claude 操作；Codex 任务仍走原有路径。取消操作会结束本次认证的进程组，待客户端退出后才释放锁。服务重启后未完成的认证显示为中断，可重新发起。

## 会话接续与数据库恢复

当前 [ReClaude 安装说明](https://docs.reclaude.ai/cli/install) 与[登录文档](https://docs.reclaude.ai/cli/login)说明：新版本将配置与历史放在各设备绑定的 `~/.rec/claude/accounts/<device_id>/config/`，退出登录保留绑定目录；旧版本或目录搬迁也可能留下 `~/.claude/projects/`。本实现按原生会话 ID 搜索这些位置，并保留校验过的只含历史的归档，不拷贝登录凭据或覆盖原历史。

重新登录前先保存所选组织的现有活跃会话历史。重新登录完成后，仅打开原会话不会执行迁移；向原会话发送新内容时才重新核验实际 Claude 账号 UUID：

- 实际账号未变：复制历史到新设备目录，沿用原生会话 ID，不占新建额度。
- 实际账号已变：使用已有的离线 SDK 分支与网络隔离复制完整历史，再在新账号下续聊。这个分支占全体账号共用的每小时 5 次额度。
- 历史冲突、归属不一致或额度不足：保留原记录并返回错误，不通过清空记录或重新创建空会话接续。

网页主库的用户、项目、工作目录和逻辑会话 ID 保持不变。会话库通过事务同时更新 `conversations` 与 `lineage`；跨主库模型配置与原生映射的更新先写 `binding_migrations` 恢复记录，完成两侧更新后才删除记录并允许发起模型请求。进程中断后重启或重试会先恢复该记录，避免重复分支及重复计数。额度继续按实际 Claude 账号统计，重新登录不清空额度记录。

客户端与 ReClaude 服务端的凭据、绑定数据仍由 CLI 自己维护，网页后端不直接修改它们的内部数据库。

## 全员切换组织并按需接续

先通过客户端设备认证绑定目标组织，再在服务端配置中保留历史组织 ID、加入新组织，并设置显式映射。例如：

```json
{
  "sharedUsers": { "workspaceDirectory": "/srv/account-pool/users", "orgIds": ["67890", "12345"] },
  "organizationRedirects": { "12345": "67890" }
}
```

映射对共享池所有网页用户生效，同时保留各自的用户、项目和工作目录。打开原会话只读取历史；下一次输入（含排队或自动续跑）才解析目标组织并离线分支。沿用旧组织默认模型的新会话也会使用新组织。映射循环、目标未加入共享池、目标尚未绑定或模型不受支持时均停止，不选择其他用户或账号代跑。

分支前持久化 `native_forks` 操作及全局额度记录；文件准备、SDK 返回的新 ID 和数据库映射分阶段保存。进程中断后复用完整分支或明确报出不确定状态，不盲目再分支。原有 `binding_migrations` 日志继续协调网页主库的模型配置与会话库的映射、谱系。

原生历史达到 128 MiB 时仅在私有分支副本中归档较早的工具结果，最近两轮、用户与助手正文、未知记录及不透明字段保持不变。从 Codex 导入的文字工具结果必须匹配已完成的导入来源及时间，不能仅凭文本前缀认定。完整结果以私有 gzip 附件保留，通过原有工具结果附件入口按会话归属下载，提示按用户、会话只显示一次。归档后仍无法满足安全上限时停止，不用摘要或空会话替代历史。原生文件与既有会话均保留。

## 验证

`scripts/reclaude-reauth.test.mjs` 使用模拟 CLI 验证命令作用域、设备链接解析、浏览器捕获与取消；服务端测试覆盖多后端互斥、发起人限制、目录搬迁及数据库恢复。`tests/reclaudeAuthorization.playwright.mjs` 使用拦截的认证接口和批准页验证桌面、手机弹窗与取消流程，不调用真实共享账号的 logout/login。
