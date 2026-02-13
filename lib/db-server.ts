// t.me/SentinelLinks

// Server-side SQLite Database Management
import Database from "better-sqlite3"
import { join } from "path"
import { existsSync, unlinkSync, renameSync } from "fs"
import { v4 as uuidv4 } from "uuid"

export interface User {
  id: string
  username: string
  password: string
  is_admin: boolean
  created_at: string
  license_key?: string
  license_expiry?: string
  uid: string
  blocked: boolean
}

export interface LicenseKey {
  id: string
  key: string
  created_by: string
  created_at: string
  duration: string
  max_activations: number
  activations: number
  is_active: boolean
}

let db: Database.Database | null = null
let dbInitialized = false

const ALLOWED_USER_FIELDS = ["username", "password", "is_admin", "license_key", "license_expiry", "blocked"] as const

function safeDeleteFile(path: string): boolean {
  try {
    if (existsSync(path)) {
      unlinkSync(path)
    }
    return true
  } catch (e: any) {
    if (e.code === "EBUSY" || e.code === "EPERM" || e.code === "EACCES") {
      try {
        const backupPath = path + ".corrupted." + Date.now()
        renameSync(path, backupPath)
        return true
      } catch (renameErr: any) {
        return false
      }
    }
    return false
  }
}

function getDB(): Database.Database {
  if (db && dbInitialized) {
    try {
      db.prepare("SELECT 1").get()
      return db
    } catch {
      db = null
      dbInitialized = false
    }
  }

  const dbPath = join(process.cwd(), "database.db")
  const altDbPath = join(process.cwd(), "database_new.db")

  try {
    db = new Database(dbPath)
    db.pragma("journal_mode = WAL")

    try {
      db.prepare("SELECT 1").get()
    } catch (testError: any) {
      try {
        db.close()
      } catch {}
      db = null

      const deleted = safeDeleteFile(dbPath) && safeDeleteFile(dbPath + "-wal") && safeDeleteFile(dbPath + "-shm")

      if (!deleted) {
        safeDeleteFile(altDbPath)
        safeDeleteFile(altDbPath + "-wal")
        safeDeleteFile(altDbPath + "-shm")

        db = new Database(altDbPath)
        db.pragma("journal_mode = WAL")
        initializeTables()
        dbInitialized = true
        return db
      }

      db = new Database(dbPath)
      db.pragma("journal_mode = WAL")
    }

    initializeTables()
    dbInitialized = true
    return db
  } catch (error: any) {
    try {
      safeDeleteFile(altDbPath)
      safeDeleteFile(altDbPath + "-wal")
      safeDeleteFile(altDbPath + "-shm")

      db = new Database(altDbPath)
      db.pragma("journal_mode = WAL")
      initializeTables()
      dbInitialized = true
      return db
    } catch (altError: any) {
      throw new Error("Database initialization failed. Please manually delete database.db and restart.")
    }
  }
}

function initializeTables() {
  if (!db) return

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      license_key TEXT,
      license_expiry TEXT,
      uid TEXT UNIQUE NOT NULL,
      blocked INTEGER DEFAULT 0
    );

// t.me/SentinelLinks
    CREATE TABLE IF NOT EXISTS license_keys (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      created_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      duration TEXT NOT NULL,
      max_activations INTEGER DEFAULT 1,
      activations INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS license_activations (
      id TEXT PRIMARY KEY,
      license_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      activated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (license_id) REFERENCES license_keys(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS device_owners (
      device_id TEXT PRIMARY KEY,
      user_uid TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

// t.me/SentinelLinks
    CREATE TABLE IF NOT EXISTS news (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'news',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT NOT NULL
    );
  `)

  try {
    const usersWithoutUID = db.prepare("SELECT id, username FROM users WHERE uid IS NULL OR uid = ''").all() as {
      id: string
      username: string
    }[]

    if (usersWithoutUID.length > 0) {
      for (const user of usersWithoutUID) {
        const newUid = uuidv4()
        db.prepare("UPDATE users SET uid = ? WHERE id = ?").run(newUid, user.id)
      }
    }
  } catch (e) {}

  try {
    const adminCheck = db
      .prepare("SELECT COUNT(*) as count FROM users WHERE username = ? COLLATE NOCASE")
      .get("Bogratkm") as { count: number }

    if (adminCheck.count === 0) {
      const userId = uuidv4()
      const userUid = uuidv4()
      db.prepare(`
        INSERT INTO users (id, username, password, is_admin, uid, license_expiry, blocked)
        VALUES (?, ?, ?, 1, ?, 'forever', 0)
      `).run(userId, "Bogratkm", "Cooldoxer67", userUid)
    }
  } catch (e) {}
}

export function getUsers(): User[] {
  try {
    const database = getDB()
    return database.prepare("SELECT * FROM users").all() as User[]
  } catch (error) {
    console.error("[DB] getUsers error:", error)
    return []
  }
}

export function getUserByUsername(username: string): User | null {
  try {
    const database = getDB()
    const user = database.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username) as
      | User
      | undefined
    return user || null
  } catch (error) {
    console.error("[DB] getUserByUsername error:", error)
    return null
  }
}

export function getUserById(id: string): User | null {
  try {
    const database = getDB()
    const user = database.prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined
    return user || null
  } catch (error) {
    console.error("[DB] getUserById error:", error)
    return null
  }
}

export function getUserByUid(uid: string): User | null {
  try {
    const database = getDB()
    const user = database.prepare("SELECT * FROM users WHERE uid = ?").get(uid) as User | undefined
    return user || null
  } catch (error) {
    console.error("[DB] getUserByUid error:", error)
    return null
  }
}

export function createUser(username: string, password: string): User | null {
  try {
    if (!username || !password) return null
    if (typeof username !== "string" || typeof password !== "string") return null

    const sanitizedUsername = username.trim().slice(0, 50)
    if (!/^[a-zA-Z0-9_]+$/.test(sanitizedUsername)) return null

    const existing = getUserByUsername(sanitizedUsername)
    if (existing) return null

    const database = getDB()
    const newUser = {
      id: uuidv4(),
      username: sanitizedUsername,
      password,
      is_admin: 0,
      uid: uuidv4(),
      blocked: 0,
    }

    database
      .prepare(`
      INSERT INTO users (id, username, password, is_admin, uid, blocked)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
      .run(newUser.id, newUser.username, newUser.password, newUser.is_admin, newUser.uid, newUser.blocked)

    return getUserById(newUser.id)
  } catch (error) {
    console.error("[DB] createUser error:", error)
    return null
  }
}

export function updateUser(userId: string, updates: Partial<User>): boolean {
  try {
    if (!userId || typeof userId !== "string") return false

    const database = getDB()

    const safeUpdates: { field: string; value: any }[] = []

    for (const [key, value] of Object.entries(updates)) {
      if (ALLOWED_USER_FIELDS.includes(key as any)) {
        safeUpdates.push({ field: key, value })
      }
    }

    if (safeUpdates.length === 0) return false

    for (const { field, value } of safeUpdates) {
      switch (field) {
        case "username":
          database.prepare("UPDATE users SET username = ? WHERE id = ?").run(value, userId)
          break
        case "password":
          database.prepare("UPDATE users SET password = ? WHERE id = ?").run(value, userId)
          break
        case "is_admin":
          database.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(value ? 1 : 0, userId)
          break
        case "license_key":
          database.prepare("UPDATE users SET license_key = ? WHERE id = ?").run(value, userId)
          break
        case "license_expiry":
          database.prepare("UPDATE users SET license_expiry = ? WHERE id = ?").run(value, userId)
          break
        case "blocked":
          database.prepare("UPDATE users SET blocked = ? WHERE id = ?").run(value ? 1 : 0, userId)
          break
      }
    }

    return true
  } catch (error) {
    console.error("[DB] updateUser error:", error)
    return false
  }
}

export function deleteUser(userId: string): boolean {
  try {
    if (!userId || typeof userId !== "string") return false

    const database = getDB()
    database.prepare("DELETE FROM users WHERE id = ? AND username != 'Bogratkm'").run(userId)
    return true
  } catch (error) {
    console.error("[DB] deleteUser error:", error)
    return false
  }
}

export function getLicenseKeys(): LicenseKey[] {
  try {
    const database = getDB()
    return database.prepare("SELECT * FROM license_keys ORDER BY created_at DESC").all() as LicenseKey[]
  } catch (error) {
    console.error("[DB] getLicenseKeys error:", error)
    return []
  }
}

export function getLicenseKeyByKey(key: string): LicenseKey | null {
  try {
    if (!key || typeof key !== "string") return null

    const database = getDB()
    return (database.prepare("SELECT * FROM license_keys WHERE key = ?").get(key) as LicenseKey | undefined) || null
  } catch (error) {
    console.error("[DB] getLicenseKeyByKey error:", error)
    return null
  }
}

export function createLicenseKey(
  createdBy: string,
  duration: number | "forever",
  maxActivations: number,
): LicenseKey | null {
  try {
    if (!createdBy || typeof createdBy !== "string") return null
    if (typeof maxActivations !== "number" || maxActivations < 1) maxActivations = 1

    const database = getDB()
    const newKey = {
      id: uuidv4(),
      key: generateRandomKey(),
      created_by: createdBy,
      duration: duration === "forever" ? "forever" : String(Math.max(1, Number(duration) || 30)),
      max_activations: Math.min(Math.max(1, maxActivations), 1000),
      activations: 0,
      is_active: 1,
    }

    database
      .prepare(`
      INSERT INTO license_keys (id, key, created_by, duration, max_activations, activations, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .run(
        newKey.id,
        newKey.key,
        newKey.created_by,
        newKey.duration,
        newKey.max_activations,
        newKey.activations,
        newKey.is_active,
      )

    return database.prepare("SELECT * FROM license_keys WHERE id = ?").get(newKey.id) as LicenseKey
  } catch (error) {
    console.error("[DB] createLicenseKey error:", error)
    return null
  }
}

export function activateLicenseKey(keyString: string, userId: string): { success: boolean; message: string } {
  try {
    if (!keyString || !userId) {
      return { success: false, message: "Неверные параметры" }
    }

    const database = getDB()
    const key = database.prepare("SELECT * FROM license_keys WHERE key = ? AND is_active = 1").get(keyString) as
      | LicenseKey
      | undefined

    if (!key) {
      return { success: false, message: "Ключ не найден или неактивен" }
    }

    if (key.activations >= key.max_activations) {
      return { success: false, message: "Превышено максимальное количество активаций" }
    }

    const existing = database
      .prepare("SELECT * FROM license_activations WHERE license_id = ? AND user_id = ?")
      .get(key.id, userId)

    if (existing) {
      return { success: false, message: "Вы уже активировали этот ключ" }
    }

    database
      .prepare("INSERT INTO license_activations (id, license_id, user_id) VALUES (?, ?, ?)")
      .run(uuidv4(), key.id, userId)

    database.prepare("UPDATE license_keys SET activations = activations + 1 WHERE id = ?").run(key.id)

    let expiry: string
    if (key.duration === "forever") {
      expiry = "forever"
    } else {
      const expiryDate = new Date()
      expiryDate.setDate(expiryDate.getDate() + Number.parseInt(key.duration))
      expiry = expiryDate.toISOString()
    }

    database.prepare("UPDATE users SET license_key = ?, license_expiry = ? WHERE id = ?").run(key.key, expiry, userId)

    return { success: true, message: "Ключ успешно активирован" }
  } catch (error) {
    console.error("[DB] activateLicenseKey error:", error)
    return { success: false, message: "Ошибка активации ключа" }
  }
}

export function deleteLicenseKey(keyId: string): boolean {
  try {
    if (!keyId || typeof keyId !== "string") return false

    const database = getDB()
    database.prepare("DELETE FROM license_keys WHERE id = ?").run(keyId)
    return true
  } catch (error) {
    console.error("[DB] deleteLicenseKey error:", error)
    return false
  }
}

function generateRandomKey(length = 16): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  let result = ""
  const randomValues = new Uint8Array(length)
  crypto.getRandomValues(randomValues)

  for (let i = 0; i < length; i++) {
    if (i > 0 && i % 4 === 0) result += "-"
    result += chars.charAt(randomValues[i] % chars.length)
  }
  return result
}

export function setDeviceOwner(deviceId: string, userUid: string): void {
  try {
    if (!deviceId || !userUid) return

    const database = getDB()
    database.prepare("INSERT OR REPLACE INTO device_owners (device_id, user_uid) VALUES (?, ?)").run(deviceId, userUid)
  } catch (error) {
    console.error("[DB] setDeviceOwner error:", error)
  }
}

export function getDevicesByUID(uid: string): string[] {
  try {
    if (!uid) return []

    const database = getDB()
    const devices = database.prepare("SELECT device_id FROM device_owners WHERE user_uid = ?").all(uid) as {
      device_id: string
    }[]
    return devices.map((d) => d.device_id)
  } catch (error) {
    console.error("[DB] getDevicesByUID error:", error)
    return []
  }
}

export function getNews(type: "news" | "changelog" = "news"): any[] {
  try {
    const database = getDB()
    return database.prepare("SELECT * FROM news WHERE type = ? ORDER BY created_at DESC").all(type) as any[]
  } catch (error) {
    console.error("[DB] getNews error:", error)
    return []
  }
}

export function createNews(title: string, content: string, type: "news" | "changelog", createdBy: string): any {
  try {
    if (!title || !content || !createdBy) return null
    const sanitizedTitle = String(title).slice(0, 200)
    const sanitizedContent = String(content).slice(0, 10000)
    const sanitizedType = type === "changelog" ? "changelog" : "news"

    const database = getDB()
    const id = uuidv4()
    database
      .prepare("INSERT INTO news (id, title, content, type, created_by) VALUES (?, ?, ?, ?, ?)")
      .run(id, sanitizedTitle, sanitizedContent, sanitizedType, createdBy)
    return database.prepare("SELECT * FROM news WHERE id = ?").get(id)
  } catch (error) {
    console.error("[DB] createNews error:", error)
    return null
  }
}

export function deleteNews(id: string): boolean {
  try {
    if (!id || typeof id !== "string") return false

    const database = getDB()
    database.prepare("DELETE FROM news WHERE id = ?").run(id)
    return true
  } catch (error) {
    console.error("[DB] deleteNews error:", error)
    return false
  }
}

export function hasValidLicense(user: User | null): boolean {
  if (!user) return false
  if (user.is_admin) return true
  if (!user.license_key || !user.license_expiry) return false
  if (user.license_expiry === "forever") return true

  const expiry = new Date(user.license_expiry)
  return expiry > new Date()
}

export function getLicenseRemainingTime(user: User | null): string | null {
  if (!user || !user.license_expiry) return null
  if (user.license_expiry === "forever") return "Навсегда"

  const expiry = new Date(user.license_expiry)
  const now = new Date()
  const diff = expiry.getTime() - now.getTime()

  if (diff <= 0) return "Истёк"

  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  if (days > 0) return `${days}д ${hours}ч`
  if (hours > 0) return `${hours}ч ${minutes}м`
  return `${minutes}м`
}

export function resetDatabase(): boolean {
  try {
    if (db) {
      db.close()
      db = null
      dbInitialized = false
    }

    const dbPath = join(process.cwd(), "database.db")
    safeDeleteFile(dbPath)
    safeDeleteFile(dbPath + "-wal")
    safeDeleteFile(dbPath + "-shm")

    getDB()
    return true
  } catch (error) {
    console.error("[DB] resetDatabase error:", error)
    return false
  }
}

//  ____             _   _            _
// / ___|  ___ _  | |_(_)_    ___| |   
// \___ \ / _ \ '_ \| | | '_ \ / _ \ | 
//  ___) |  / | | | |_| | | | |  / |   
// |____/ \___|_| |_|\|_|_| |_|\___|_| 
// ********************************    
