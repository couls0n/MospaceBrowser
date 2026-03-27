import log from 'electron-log/main'
import { getAppPaths } from '@main/utils/paths'

export const logger = log

export function configureLogger(): void {
  const paths = getAppPaths()

  log.initialize()
  log.transports.file.level = 'info'
  log.transports.file.resolvePathFn = () => `${paths.logs}/main.log`
  log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn'
}
