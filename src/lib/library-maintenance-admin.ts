export function isLibraryMaintenanceAdmin(
  userId: string,
  allowlist = process.env.LIBRARY_MAINTENANCE_ADMIN_USER_IDS
): boolean {
  if (!allowlist) return false
  return allowlist
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(userId)
}
