# enterprise/env/ —— 多环境配置隔离（dev / staging / prod）

同一份代码、同一套 enterprise profile，用「两层差异 + 一个运行器」隔离三个环境。
**不修改任何 dsh 核心源码**；所有差异都落在本目录与运行器里。

## 环境差异切分

| 差异 | dev | staging | prod |
| --- | --- | --- | --- |
| 数据库 | 本机 `DSH` | `DSH_Staging`（独立库） | `DSH_Prod`（独立库/远端） |
| 租户演示开关 | `*_TENANT=demo` | `demo` | `demo`（可删行切严格隔离） |
| web 端口 | 3080 | 3081 | 3082 |
| system-prompt-hook debug | 开 | 开 | 关 |
| 绑定 host | 127.0.0.1 | 127.0.0.1 | 127.0.0.1（生产建议前置反代） |

三个环境可**同时启动**互不干扰（端口/库均不同）——这正是"配置隔离"的直观验证。

## 每层职责

- **`<env>.env`** —— 环境**变量**：数据源连接串、租户开关。bash 语法，值含空格/分号必须加
  双引号；可用 `${ORDER_DB_MSSQL}` 引用前面已定义变量（去重）。启动决策类变量
  （PATH/DSH_*/代理）不能放这里，要 export。
- **`common.cordis.yml`** —— 公共 overlay：与环境无关的插件行调参（企业 persona 等）。
- **`<env>.cordis.yml`** —— 环境差异 overlay：webserver host/port、system-prompt-hook
  debug 等按 id 覆盖行 config（overlay 整体替换 config，省略字段交给插件默认值兜底）。
- **`run-web-env.sh`**（在 `enterprise/` 下）—— 运行器：校验环境名 → source 对应
  `.env` → 以 `--patch common --patch <env>` 启动/预览。

## 使用

```sh
# 启动（前台 Ctrl+C 停；或加 --bg 后台，日志 dsh-web-<env>.log）
bash enterprise/run-web-env.sh dev
bash enterprise/run-web-env.sh staging --bg

# 免启动预览该环境的组合配置树（验证层叠与差异）
bash enterprise/run-web-env.sh dev --dump

# 停某个后台实例：按端口找 pid
MSYS_NO_PATHCONV=1 taskkill /PID $(netstat -ano | grep ':3081' | grep LISTEN | awk '{print $5}') /F
```

## 组合装载顺序（dsh 原生模型）

bundle patch（各 Bundle 自带）→ profile 自身 `cordis.patch.yml` → home
`$DSH_HOME/cordis.patch.yml` → `--patch common.cordis.yml` → `--patch <env>.cordis.yml`
（后加载优先）。运行器与 `--dump-config` 用同一装载链，所见即所启。

## 生产隔离建议

- 生产用独立 `DSH_HOME`（凭据、settings.yaml、profiles 全隔离）：
  `DSH_HOME=/etc/dsh-prod bash enterprise/run-web-env.sh prod`
- 生产数据库密码不要写进 `prod.env` 并提交仓库——应经密钥管理注入调用环境后，删除
  `.env` 中对应行再启动（注意：运行器 `source <env>.env` 会用文件值**覆盖**同名继承变量，
  所以外部注入 = 不写该行，由调用方 export）。
- 首次连新库前先建空库（表与种子由 biz Bundle 的 ensureSchema 自动建立）：
  `sqlcmd -S <host> -U <user> -P '<pwd>' -Q "IF DB_ID('DSH_Staging') IS NULL CREATE DATABASE DSH_Staging"`

## 变量清单与模板（*.env 不入库，本地按此重建）

每个 `<env>.env` 由下面模板复制改名而来（`<ENV>` = dev/staging/prod，库名相应为
`DSH`/`DSH_Staging`/`DSH_Prod`）。值含空格/分号必须整体加双引号。生产密码不写入，
改由调用方 export 注入（见上「生产隔离建议」）。

```bash
# —— 公共 ——
DSH_ENV=<env>
# —— biz 数据源选择（缺省回退 mock）——
USER_DATASOURCE=mssql
ORDER_DATASOURCE=mssql
KNOWLEDGE_DATASOURCE=mssql
INVOICE_DATASOURCE=mssql
INVENTORY_DATASOURCE=mssql
# —— 连接串（每 Bundle 一组；库名按环境）——
USER_DB_MSSQL="Server=localhost,1433;Database=DSH_<ENV>;User Id=sa;Password=<你的密码>;TrustServerCertificate=true;Encrypt=true;"
ORDER_DB_MSSQL="Server=localhost,1433;Database=DSH_<ENV>;User Id=sa;Password=<你的密码>;TrustServerCertificate=true;Encrypt=true;"
KNOWLEDGE_DB_MSSQL="Server=localhost,1433;Database=DSH_<ENV>;User Id=sa;Password=<你的密码>;TrustServerCertificate=true;Encrypt=true;"
INVOICE_DB_MSSQL="Server=localhost,1433;Database=DSH_<ENV>;User Id=sa;Password=<你的密码>;TrustServerCertificate=true;Encrypt=true;"
INVENTORY_DB_MSSQL="Server=localhost,1433;Database=DSH_<ENV>;User Id=sa;Password=<你的密码>;TrustServerCertificate=true;Encrypt=true;"
# —— 多租户演示开关（demo 租户已含种子数据，便于验证）——
USER_TENANT=demo
ORDER_TENANT=demo
KNOWLEDGE_TENANT=demo
INVOICE_TENANT=demo
INVENTORY_TENANT=demo
```
