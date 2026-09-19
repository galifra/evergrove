export function checkAppCode(req) {
  const requiredCode = process.env.APP_ACCESS_CODE
  if (!requiredCode) return true
  return req.headers['x-app-code'] === requiredCode
}
