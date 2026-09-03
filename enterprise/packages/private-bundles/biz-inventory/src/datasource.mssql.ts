/**
 * biz-inventory 的 SQL Server 实现。
 *
 * 与 biz-order / biz-user / biz-knowledge / biz-invoice 同一套样板：
 *   惰性建连 → ensureSchema() 自动建表（不存在才建）并 seed demo 种子 → 参数化多租户查询。
 * 通过 getInventoryDataSource() 工厂按 INVENTORY_DATASOURCE=mssql 选择本实现，
 * 业务工具代码零改动。连接串读 INVENTORY_DB_MSSQL 环境变量。
 */

import mssql from 'mssql'
import type { InventoryDataSource, InventoryFilter, InventoryItem, StockStatus } from './types'

const ALL_STATUSES: StockStatus[] = ['in_stock', 'low_stock', 'out_of_stock', 'reserved']

const CONN = process.env.INVENTORY_DB_MSSQL

/** demo 种子：与 mock 数据源保持一致，便于切换实现时行为可预期。 */
const SEED_ITEMS: InventoryItem[] = [
  { id: 'INV-1001', sku: 'SKU-A001', name: '智能摄像头 Pro', warehouse: '上海仓', quantity: 120, reserved: 10, status: 'in_stock', tenant: 'demo' },
  { id: 'INV-1002', sku: 'SKU-A002', name: '边缘计算网关', warehouse: '上海仓', quantity: 8, reserved: 2, status: 'low_stock', tenant: 'demo' },
  { id: 'INV-1003', sku: 'SKU-B001', name: '工业传感器套件', warehouse: '深圳仓', quantity: 0, reserved: 0, status: 'out_of_stock', tenant: 'demo' },
  { id: 'INV-1004', sku: 'SKU-B002', name: 'AI 训练服务器', warehouse: '北京仓', quantity: 50, reserved: 50, status: 'reserved', tenant: 'demo' },
]

let poolPromise: Promise<mssql.ConnectionPool> | null = null

function getPool(): Promise<mssql.ConnectionPool> {
  if (!poolPromise) {
    if (!CONN) throw new Error('INVENTORY_DB_MSSQL 未配置，无法连接 SQL Server')
    poolPromise = new mssql.ConnectionPool(CONN).connect()
  }
  return poolPromise
}

/** 建表（不存在才建）+ 幂等 seed。库存表名避开保留字，直接叫 biz_inventory。 */
async function ensureSchema(pool: mssql.ConnectionPool): Promise<void> {
  await pool.request().query(`
    IF OBJECT_ID('dbo.biz_inventory', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.biz_inventory (
        id        NVARCHAR(32)  NOT NULL PRIMARY KEY,
        sku       NVARCHAR(32)  NOT NULL,
        name      NVARCHAR(200) NOT NULL,
        warehouse NVARCHAR(64)  NOT NULL,
        quantity  INT           NOT NULL,
        reserved  INT           NOT NULL,
        status    NVARCHAR(16)  NOT NULL,
        tenant    NVARCHAR(64)  NOT NULL
      );
    END
  `)
  const { recordset } = await pool.request().query(`SELECT COUNT(*) AS n FROM dbo.biz_inventory`)
  if (Number(recordset[0].n) === 0) {
    for (const it of SEED_ITEMS) {
      await pool.request()
        .input('id', mssql.NVarChar, it.id)
        .input('sku', mssql.NVarChar, it.sku)
        .input('name', mssql.NVarChar, it.name)
        .input('warehouse', mssql.NVarChar, it.warehouse)
        .input('quantity', mssql.Int, it.quantity)
        .input('reserved', mssql.Int, it.reserved)
        .input('status', mssql.NVarChar, it.status)
        .input('tenant', mssql.NVarChar, it.tenant)
        .query(`
          INSERT INTO dbo.biz_inventory (id, sku, name, warehouse, quantity, reserved, status, tenant)
          VALUES (@id, @sku, @name, @warehouse, @quantity, @reserved, @status, @tenant)
        `)
    }
  }
}

function rowToItem(row: Record<string, unknown>): InventoryItem {
  return {
    id: String(row.id),
    sku: String(row.sku),
    name: String(row.name),
    warehouse: String(row.warehouse),
    quantity: Number(row.quantity),
    reserved: Number(row.reserved),
    status: String(row.status) as StockStatus,
    tenant: String(row.tenant),
  }
}

export class SqlServerInventoryDataSource implements InventoryDataSource {
  async listItems(tenant: string, filter?: InventoryFilter, limit = 10): Promise<InventoryItem[]> {
    const pool = await getPool()
    await ensureSchema(pool)
    const req = pool.request()
    const conds: string[] = ['tenant = @tenant']
    req.input('tenant', mssql.NVarChar, tenant)
    if (filter?.status) {
      conds.push('status = @status')
      req.input('status', mssql.NVarChar, filter.status)
    }
    if (filter?.warehouse) {
      conds.push('warehouse = @warehouse')
      req.input('warehouse', mssql.NVarChar, filter.warehouse)
    }
    if (filter?.keyword) {
      conds.push('(name LIKE @kw OR sku LIKE @kw OR id LIKE @kw)')
      req.input('kw', mssql.NVarChar, `%${filter.keyword}%`)
    }
    const n = Math.max(1, limit)
    const { recordset } = await req.query(`
      SELECT TOP (${n}) id, sku, name, warehouse, quantity, reserved, status, tenant
      FROM dbo.biz_inventory
      WHERE ${conds.join(' AND ')}
      ORDER BY id
    `)
    return recordset.map(rowToItem)
  }

  /** 按 SKU 或库存 ID 匹配（与 mock 语义一致）。 */
  async getItem(tenant: string, sku: string): Promise<InventoryItem | null> {
    const pool = await getPool()
    await ensureSchema(pool)
    const { recordset } = await pool.request()
      .input('tenant', mssql.NVarChar, tenant)
      .input('sku', mssql.NVarChar, sku)
      .query(`
        SELECT id, sku, name, warehouse, quantity, reserved, status, tenant
        FROM dbo.biz_inventory
        WHERE tenant = @tenant AND (sku = @sku OR id = @sku)
      `)
    return recordset[0] ? rowToItem(recordset[0]) : null
  }

  /** 去重列出当前租户下的仓库名（查库，需异步）。 */
  async listWarehouses(tenant: string): Promise<readonly string[]> {
    const pool = await getPool()
    await ensureSchema(pool)
    const { recordset } = await pool.request()
      .input('tenant', mssql.NVarChar, tenant)
      .query(`SELECT DISTINCT warehouse FROM dbo.biz_inventory WHERE tenant = @tenant`)
    return recordset.map(r => String(r.warehouse))
  }

  listStatuses(): readonly StockStatus[] {
    return ALL_STATUSES
  }
}
