export const keybindings = [
  ["Enter", "提交 Composer 中的自然语言任务"],
  ["Ctrl+J", "在 Composer 中换行"],
  ["Ctrl+T", "切换对话对象 core/planner/reviewer/judge/coder"],
  ["Tab", "切换检查面板"],
  ["Esc", "清空当前输入"],
  ["Ctrl+Q", "退出"],
  ["Ctrl+A", "partial mode 下授权/应用补丁"],
  ["Ctrl+R", "partial mode 下运行测试命令"],
  ["Ctrl+U", "撤销最近补丁"],
  ["Ctrl+P", "打开权限模式面板"],
  ["Ctrl+M", "打开模型/路由面板"],
  ["/run ...", "显式启动 workflow"],
  ["/ask ...", "只记录一次非修改型定向对话"],
  ["/to reviewer ...", "直接对某个角色说话"],
  ["/mode full", "切换 restricted/partial/full 访问模式"]
] as const;
