// t.me/SentinelLinks

// SQLite Database Management Library
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

// Database API client
class DatabaseClient {
  private baseUrl: string

  constructor() {
    this.baseUrl = "/api/db"
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    })

// t.me/SentinelLinks
    if (!response.ok) {
      throw new Error("Database query failed")
    }

    const data = await response.json()
    return data.rows || []
  }

  async execute(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertRowid: number }> {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params, execute: true }),
    })

// t.me/SentinelLinks
    if (!response.ok) {
      throw new Error("Database execution failed")
    }

    return await response.json()
  }
}

export const db = new DatabaseClient()

// User Management
export async function getUsers(): Promise<User[]> {
  return await db.query<User>("SELECT * FROM users")
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const users = await db.query<User>("SELECT * FROM users WHERE username = ? COLLATE NOCASE", [username])
  return users[0] || null
}

export async function getUserById(id: string): Promise<User | null> {
  const users = await db.query<User>("SELECT * FROM users WHERE id = ?", [id])
  return users[0] || null
}

// t.me/SentinelLinks
export async function createUser(username: string, password: string): Promise<User | null> {
  const existing = await getUserByUsername(username)
  if (existing) return null

  const newUser = {
    id: uuidv4(),
    username,
    password,
    is_admin: 0,
    uid: uuidv4(),
    blocked: 0,
  }

  await db.execute(
    `INSERT INTO users (id, username, password, is_admin, uid, blocked) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    [newUser.id, newUser.username, newUser.password, newUser.is_admin, newUser.uid, newUser.blocked],
  )

  return await getUserById(newUser.id)
}

export async function updateUser(userId: string, updates: Partial<User>): Promise<boolean> {
  const fields = Object.keys(updates)
    .map((key) => `${key} = ?`)
    .join(", ")
  const values = [...Object.values(updates), userId]

  await db.execute(`UPDATE users SET ${fields} WHERE id = ?`, values)
  return true
}

export async function deleteUser(userId: string): Promise<boolean> {
  await db.execute("DELETE FROM users WHERE id = ? AND username != 'ORIXMAN'", [userId])
  return true
}

// License Management
export async function getLicenseKeys(): Promise<LicenseKey[]> {
  return await db.query<LicenseKey>("SELECT * FROM license_keys ORDER BY created_at DESC")
}

export async function createLicenseKey(
  createdBy: string,
  duration: number | "forever",
  maxActivations: number,
): Promise<LicenseKey> {
  const newKey = {
    id: uuidv4(),
    key: generateRandomKey(),
    created_by: createdBy,
    duration: duration === "forever" ? "forever" : duration.toString(),
    max_activations: maxActivations,
    activations: 0,
    is_active: 1,
  }

  await db.execute(
    `INSERT INTO license_keys (id, key, created_by, duration, max_activations, activations, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      newKey.id,
      newKey.key,
      newKey.created_by,
      newKey.duration,
      newKey.max_activations,
      newKey.activations,
      newKey.is_active,
    ],
  )

  const keys = await db.query<LicenseKey>("SELECT * FROM license_keys WHERE id = ?", [newKey.id])
  return keys[0]
}

export async function activateLicenseKey(
  keyString: string,
  userId: string,
): Promise<{ success: boolean; message: string }> {
  const keys = await db.query<LicenseKey>("SELECT * FROM license_keys WHERE key = ? AND is_active = 1", [keyString])

  if (keys.length === 0) {
    return { success: false, message: "Ключ не найден или неактивен" }
  }

  const key = keys[0]

  if (key.activations >= key.max_activations) {
    return { success: false, message: "Превышено максимальное количество активаций" }
  }

  const existing = await db.query("SELECT * FROM license_activations WHERE license_id = ? AND user_id = ?", [
    key.id,
    userId,
  ])

  if (existing.length > 0) {
    return { success: false, message: "Вы уже активировали этот ключ" }
  }

  await db.execute("INSERT INTO license_activations (id, license_id, user_id) VALUES (?, ?, ?)", [
    uuidv4(),
    key.id,
    userId,
  ])

  await db.execute("UPDATE license_keys SET activations = activations + 1 WHERE id = ?", [key.id])

  let expiry: string
  if (key.duration === "forever") {
    expiry = "forever"
  } else {
    const expiryDate = new Date()
    expiryDate.setDate(expiryDate.getDate() + Number.parseInt(key.duration))
    expiry = expiryDate.toISOString()
  }

  await db.execute("UPDATE users SET license_key = ?, license_expiry = ? WHERE id = ?", [key.key, expiry, userId])

  return { success: true, message: "Ключ успешно активирован" }
}

export async function deleteLicenseKey(keyId: string): Promise<boolean> {
  await db.execute("DELETE FROM license_keys WHERE id = ?", [keyId])
  return true
}

function generateRandomKey(length = 16): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  let result = ""
  for (let i = 0; i < length; i++) {
    if (i > 0 && i % 4 === 0) result += "-"
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// Device ownership
export async function setDeviceOwner(deviceId: string, userUid: string): Promise<void> {
  // Store in localStorage for client-side
  const owners = JSON.parse(localStorage.getItem("grob-device_owners") || "[]")
  const existingIndex = owners.findIndex((o: any) => o.device_id === deviceId)

  if (existingIndex >= 0) {
    owners[existingIndex].user_uid = userUid
  } else {
    owners.push({ device_id: deviceId, user_uid: userUid })
  }

  localStorage.setItem("grob-device_owners", JSON.stringify(owners))

  // Also try to store in database if available
  try {
    await db.execute("INSERT OR REPLACE INTO device_owners (device_id, user_uid) VALUES (?, ?)", [deviceId, userUid])
  } catch (error) {
    // Silent error
  }
}

export async function getDevicesByUID(uid: string): Promise<string[]> {
  // Try localStorage first
  const owners = JSON.parse(localStorage.getItem("grob-device_owners") || "[]")
  const deviceIds = owners.filter((o: any) => o.user_uid === uid).map((o: any) => o.device_id)

  if (deviceIds.length > 0) {
    return deviceIds
  }

  // Fallback to database
  try {
    const devices = await db.query<{ device_id: string }>("SELECT device_id FROM device_owners WHERE user_uid = ?", [
      uid,
    ])
    return devices.map((d) => d.device_id)
  } catch (error) {
    return deviceIds
  }
}

// Helpers
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

//  ____             _   _            _
// / ___|  ___ _  | |_(_)_    ___| |   
// \___ \ / _ \ '_ \| | | '_ \ / _ \ | 
//  ___) |  / | | | |_| | | | |  / |   
// |____/ \___|_| |_|\|_|_| |_|\___|_| 
// ********************************    
