import { z } from 'zod'

export const BrowserWindowSchema = z.object({
  width: z.number().int().min(800).max(3840),
  height: z.number().int().min(600).max(2160),
  pixelRatio: z.number().min(1).max(3)
})

export const BrowserConfigSchema = z.object({
  locale: z.string().min(2).max(20),
  timezone: z.string().min(3).max(100),
  colorScheme: z.enum(['system', 'light', 'dark']),
  homeUrl: z.string().url(),
  window: BrowserWindowSchema
})

export const ProxyConfigSchema = z.object({
  type: z.enum(['none', 'http', 'https', 'socks5']),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(255).optional(),
  password: z.string().max(255).optional()
})

export const CreateProfileSchema = z.object({
  name: z.string().min(1).max(100),
  notes: z.string().max(1000).optional(),
  browserConfig: BrowserConfigSchema,
  proxyConfig: ProxyConfigSchema.optional(),
  groupId: z.string().uuid().optional()
})

export const UpdateProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  notes: z.string().max(1000).optional(),
  browserConfig: BrowserConfigSchema.optional(),
  proxyConfig: ProxyConfigSchema.optional(),
  groupId: z.string().uuid().optional()
})

export const DeleteProfileSchema = z.object({
  id: z.string().uuid(),
  removeData: z.boolean().optional()
})

export const CloneProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional()
})

export const ProfileFilterSchema = z.object({
  groupId: z.string().uuid().optional()
})

export const StartProfileSchema = z.object({
  profileId: z.string().uuid()
})

export const StopProfileSchema = StartProfileSchema

export const OpenDirectorySchema = z.object({
  path: z.string().min(1)
})

export const CreateProxySchema = z.object({
  name: z.string().max(100).optional(),
  type: z.enum(['http', 'https', 'socks5']),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(255).optional(),
  password: z.string().max(255).optional()
})

export const DeleteProxySchema = z.object({
  id: z.string().uuid()
})

export const CheckProxySchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535)
})
