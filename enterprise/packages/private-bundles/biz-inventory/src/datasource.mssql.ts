/**
 * biz-inventory 的 SQL Server 实现。
 *
 * 惰性建连 → ensureSchema() 自动建表（不存在才建）→ 参数化多租户查询。
 * 不写入任何种子数据——数据一律由数据库侧管理。
 * 连接串读 INVENTORY_DB_MSSQL 环境变量。
 */

import mssql from 'mssql'
import { generateBusinessId, getSharedPool } from '@my-company/biz-shared'
import type {
  CreateInventoryItemInput,
  InventoryDataSource,
  InventoryFilter,
  InventoryItem,
  InventoryStatusSummary,
  StockStatus,
  WarehouseSummary,
} from './types'

const ALL_STATUSES: StockStatus[] = ['in_stock', 'low_stock', 'out_of_stock', 'reserved']

const CONN = process.env.INVENTORY_DB_MSSQL!

/** 建表（不存在才建）。库存表名避开保留字，直接叫 biz_inventory。 */
async function ensureSchema(pool: mssql.ConnectionPool): Promise<void> {
  await pool.request().query(`
    IF OBJECT_ID('dbo.biz_inventory', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.biz_inventory (
        id           NVARCHAR(32)   NOT NULL PRIMARY KEY,
        sku          NVARCHAR(32)   NOT NULL,
        name         NVARCHAR(200)  NOT NULL,
        warehouse    NVARCHAR(64)   NOT NULL,
        location     NVARCHAR(32)   NULL,           -- 库位编码
        quantity     INT            NOT NULL,
        reserved     INT            NOT NULL,
        status       NVARCHAR(16)   NOT NULL,
        unitCost     decimal(18,2)  NULL,           -- 单位成本
        supplier     NVARCHAR(64)   NULL,
        safetyStock  INT            NULL,           -- 安全库存阈值
        lastStockAt  NVARCHAR(32)   NULL,           -- 最近出入库时间
        tenant       NVARCHAR(64)   NOT NULL
      );
    END
  `)
}

const COLUMNS = 'id, sku, name, warehouse, location, quantity, reserved, status, unitCost, supplier, safetyStock, lastStockAt, tenant'

function rowToItem(row: Record<string, unknown>): InventoryItem {
  return {
    id: String(row.id),
    sku: String(row.sku),
    name: String(row.name),
    warehouse: String(row.warehouse),
    location: row.location == null ? '' : String(row.location),
    quantity: Number(row.quantity),
    reserved: Number(row.reserved),
    status: String(row.status) as StockStatus,
    unitCost: Number(row.unitCost ?? 0),
    supplier: row.supplier == null ? '' : String(row.supplier),
    safetyStock: Number(row.safetyStock ?? 0),
    lastStockAt: row.lastStockAt == null ? '' : String(row.lastStockAt),
    tenant: String(row.tenant),
  }
}

export class SqlServerInventoryDataSource implements InventoryDataSource {
  async listItems(tenant: string, filter?: InventoryFilter, limit = 10): Promise<InventoryItem[]> {
    const pool = await getSharedPool(CONN)
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
      SELECT TOP (${n}) ${COLUMNS}
      FROM dbo.biz_inventory
      WHERE ${conds.join(' AND ')}
      ORDER BY id
    `)
    return recordset.map(rowToItem)
  }

  /** 按 SKU 或库存 ID 匹配（与 mock 语义一致）。 */
  async getItem(tenant: string, sku: string): Promise<InventoryItem | null> {
    const pool = await getSharedPool(CONN)
    await ensureSchema(pool)
    const { recordset } = await pool.request()
      .input('tenant', mssql.NVarChar, tenant)
      .input('sku', mssql.NVarChar, sku)
      .query(`
        SELECT ${COLUMNS}
        FROM dbo.biz_inventory
        WHERE tenant = @tenant AND (sku = @sku OR id = @sku)
      `)
    return recordset[0] ? rowToItem(recordset[0]) : null
  }

  /** 去重列出当前租户下的仓库名（查库，需异步）。 */
  async listWarehouses(tenant: string): Promise<readonly string[]> {
    const pool = await getSharedPool(CONN)
    await ensureSchema(pool)
    const { recordset } = await pool.request()
      .input('tenant', mssql.NVarChar, tenant)
      .query(`SELECT DISTINCT warehouse FROM dbo.biz_inventory WHERE tenant = @tenant`)
    return recordset.map(r => String(r.warehouse))
  }

  listStatuses(): readonly StockStatus[] {
    return ALL_STATUSES
  }

  /** 用 GROUP BY 让数据库算分布，避免把整表拉回内存。 */
  async summarizeByStatus(tenant: string): Promise<InventoryStatusSummary[]> {
    const pool = await getSharedPool(CONN)
    await ensureSchema(pool)
    const { recordset } = await pool.request()
      .input('tenant', mssql.NVarChar, tenant)
      .query(`
        SELECT
          status,
          COUNT(*)                  AS skuCount,
          SUM(quantity)             AS totalQuantity,
          SUM(quantity - reserved)  AS totalAvailable
        FROM dbo.biz_inventory
        WHERE tenant = @tenant
        GROUP BY status
      `)
    const map = new Map<string, InventoryStatusSummary>()
    for (const row of recordset as Array<Record<string, unknown>>) {
      map.set(String(row.status), {
        status: String(row.status) as StockStatus,
        skuCount: Number(row.skuCount ?? 0),
        totalQuantity: Number(row.totalQuantity ?? 0),
        totalAvailable: Number(row.totalAvailable ?? 0),
      })
    }
    // 补齐空状态，保证返回结构稳定
    return ALL_STATUSES.map(status => map.get(status) ?? {
      status, skuCount: 0, totalQuantity: 0, totalAvailable: 0,
    })
  }

  /** 按仓库聚合，同时给出缺货/低库存计数，便于定位风险仓。 */
  async summarizeByWarehouse(tenant: string): Promise<WarehouseSummary[]> {
    const pool = await getSharedPool(CONN)
    await ensureSchema(pool)
    const { recordset } = await pool.request()
      .input('tenant', mssql.NVarChar, tenant)
      .query(`
        SELECT
          warehouse,
          COUNT(*)                                                AS skuCount,
          SUM(quantity)                                           AS totalQuantity,
          SUM(CASE WHEN status = 'low_stock'    THEN 1 ELSE 0 END) AS lowStockCount,
          SUM(CASE WHEN status = 'out_of_stock' THEN 1 ELSE 0 END) AS outOfStockCount
        FROM dbo.biz_inventory
        WHERE tenant = @tenant
        GROUP BY warehouse
        ORDER BY warehouse
      `)
    return (recordset as Array<Record<string, unknown>>).map(row => ({
      warehouse: String(row.warehouse),
      skuCount: Number(row.skuCount ?? 0),
      totalQuantity: Number(row.totalQuantity ?? 0),
      lowStockCount: Number(row.lowStockCount ?? 0),
      outOfStockCount: Number(row.outOfStockCount ?? 0),
    }))
  }

  /**
   * 入库：quantity += 补货数量并刷新 status（基于新 quantity 与 safetyStock 推算），
   * 同时更新 lastStockAt。SKU 不存在则报错。
   *
   * status 必须是 quantity/safetyStock 的派生字段，否则会出现"数量 1 但状态仍是
   * out_of_stock"的脏数据（补货后没有触发出库/入库的视图刷新）。
   */
  async restock(tenant: string, sku: string, quantity: number): Promise<InventoryItem> {
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('补货数量必须为正数')
    const pool = await getSharedPool(CONN)
    await ensureSchema(pool)
    // 单语句同时改 quantity 与重新计算 status，避免读改写竞态。
    // 推算规则与 createItem 保持一致：quantity=0 → out_of_stock；
    //   quantity<=safetyStock 且 safetyStock>0 → low_stock；否则 in_stock。
    const res = await pool.request()
      .input('qty', mssql.Int, quantity)
      .input('sku', mssql.NVarChar, sku)
      .input('tenant', mssql.NVarChar, tenant)
      .input('now', mssql.NVarChar, new Date().toISOString().slice(0, 10))
      .query(
        `UPDATE dbo.biz_inventory
            SET quantity = quantity + @qty,
                lastStockAt = @now,
                status = CASE
                  WHEN quantity + @qty = 0 THEN 'out_of_stock'
                  WHEN ISNULL(safetyStock, 0) > 0
                       AND quantity + @qty <= safetyStock THEN 'low_stock'
                  ELSE 'in_stock'
                END
          WHERE sku = @sku AND tenant = @tenant`,
      )
    if ((res.rowsAffected?.[0] ?? 0) === 0) {
      throw new Error(`SKU ${sku} 在当前租户不存在，无法入库（请先创建库存记录）`)
    }
    return (await this.getItem(tenant, sku))!
  }

  /**
   * 出库/扣减：quantity -= 扣减数量并刷新 status。SKU 不存在或库存不足则报错。
   * status 同 restock：必须是 quantity/safetyStock 的派生字段，UPDATE 一并刷新。
   */
  async deduct(tenant: string, sku: string, quantity: number): Promise<InventoryItem> {
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('扣减数量必须为正数')
    const pool = await getSharedPool(CONN)
    await ensureSchema(pool)
    // 条件扣减：仅当当前库存 >= 扣减数量时才更新，避免扣成负数。
    // status 在 quantity 变化后立刻重算，无需二次 round-trip。
    const res = await pool.request()
      .input('qty', mssql.Int, quantity)
      .input('sku', mssql.NVarChar, sku)
      .input('tenant', mssql.NVarChar, tenant)
      .input('now', mssql.NVarChar, new Date().toISOString().slice(0, 10))
      .query(
        `UPDATE dbo.biz_inventory
            SET quantity = quantity - @qty,
                lastStockAt = @now,
                status = CASE
                  WHEN quantity - @qty = 0 THEN 'out_of_stock'
                  WHEN ISNULL(safetyStock, 0) > 0
                       AND quantity - @qty <= safetyStock THEN 'low_stock'
                  ELSE 'in_stock'
                END
          WHERE sku = @sku AND tenant = @tenant AND quantity >= @qty`,
      )
    if ((res.rowsAffected?.[0] ?? 0) === 0) {
      const existing = await this.getItem(tenant, sku)
      if (!existing) throw new Error(`SKU ${sku} 在当前租户不存在，无法扣减（请先建档）`)
      throw new Error(`SKU ${sku} 库存不足（当前 ${existing.quantity}，需扣减 ${quantity}）`)
    }
    return (await this.getItem(tenant, sku))!
  }

  /** 新建库存档案（建档）：录入一个新 SKU 的初始库存。SKU 已存在则报错。 */
  async createItem(tenant: string, input: CreateInventoryItemInput): Promise<InventoryItem> {
    const sku = String(input.sku ?? '').trim()
    if (!sku) throw new Error('SKU 不能为空')
    const name = String(input.name ?? '').trim()
    if (!name) throw new Error('商品名称不能为空')
    const warehouse = String(input.warehouse ?? '').trim()
    if (!warehouse) throw new Error('仓库不能为空')

    const pool = await getSharedPool(CONN)
    await ensureSchema(pool)
    // 幂等：同租户下 SKU 已建档则拒绝重复创建
    const dup = await pool.request()
      .input('sku', mssql.NVarChar, sku)
      .input('tenant', mssql.NVarChar, tenant)
      .query('SELECT id FROM dbo.biz_inventory WHERE sku = @sku AND tenant = @tenant')
    if (dup.recordset.length > 0) {
      throw new Error(`SKU ${sku} 已建档（ID ${String(dup.recordset[0].id)}），无需重复创建`)
    }

    const id = generateBusinessId('INV')
    const quantity = Number(input.quantity ?? 0)
    const unitCost = Number(input.unitCost ?? 0)
    const safetyStock = Number(input.safetyStock ?? 0)
    const location = String(input.location ?? '').trim()
    const supplier = String(input.supplier ?? '').trim()
    const lastStockAt = new Date().toISOString().slice(0, 10)
    // 状态按初始库存与安全库存推断
    const status: StockStatus = quantity === 0
      ? 'out_of_stock'
      : (safetyStock > 0 && quantity <= safetyStock ? 'low_stock' : 'in_stock')

    await pool.request()
      .input('id', mssql.NVarChar, id)
      .input('sku', mssql.NVarChar, sku)
      .input('name', mssql.NVarChar, name)
      .input('warehouse', mssql.NVarChar, warehouse)
      .input('location', mssql.NVarChar, location)
      .input('quantity', mssql.Int, quantity)
      .input('reserved', mssql.Int, 0)
      .input('status', mssql.NVarChar, status)
      .input('unitCost', mssql.Decimal(18, 2), unitCost)
      .input('supplier', mssql.NVarChar, supplier)
      .input('safetyStock', mssql.Int, safetyStock)
      .input('lastStockAt', mssql.NVarChar, lastStockAt)
      .input('tenant', mssql.NVarChar, tenant)
      .query(
        'INSERT INTO dbo.biz_inventory (id, sku, name, warehouse, location, quantity, reserved, status, unitCost, supplier, safetyStock, lastStockAt, tenant) '
        + 'VALUES (@id, @sku, @name, @warehouse, @location, @quantity, @reserved, @status, @unitCost, @supplier, @safetyStock, @lastStockAt, @tenant)',
      )

    return (await this.getItem(tenant, sku))!
  }
}
