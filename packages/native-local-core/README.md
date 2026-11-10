# Note Flow local SQLite core

公开本地存储候选，不包含账号、网络传输、同步 planner 或高级重复算法。

`LocalStore` 提供实体读取、按类型/UID 分页、按 sequence 日志分页和带 read-set/CAS 校验的原子提交。每个写入必须带匹配的 profile、action、前后 revision 和唯一日志 ID；日志保存不可变实体快照。删除保留墓碑，显式恢复须使用墓碑修订号。

新库使用独立的 community schema 标记。拒绝初始化已有其他表的外部库、缺少标记的 v1 库以及未来 schema。平台壳仍必须绑定自己的受控数据路径，不向界面暴露任意路径打开接口。

```sh
cargo test --locked --manifest-path packages/native-local-core/Cargo.toml
```

已提供粗粒度请求协议与 TS 原生宿主适配，媒体使用便携编码，支持 Web/SQLite 备份往返及空 profile 原子恢复。真实 Rust 进程联调运行 `npm run test:native`（独立候选根目录），覆盖二进制附件、双连接冲突、基础重复和分页。首次并发打开的 schema 初始化在写锁内串行执行。

已接入公共Tauri/JNI宿主；原生纯搜索与标准化在src/search.rs维护，桌面及官方移动桥复用同一实现。官方原有数据库不由此替换；移动旧SQLite升级采用完整导出保护，真机缺口仍按原任务跟踪。许可证随公开候选统一确定，当前不作为完成授权的发行包发布。
