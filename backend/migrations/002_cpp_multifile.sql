-- 多文件快照正文仍保存在 SourceStore；数据库只补充按项目清理历史数据所需索引。
ALTER TABLE cpp_revisions ADD INDEX idx_cpp_revisions_project_time(project_id, created_at);
ALTER TABLE cpp_runs ADD INDEX idx_cpp_runs_project_time(project_id, created_at);
