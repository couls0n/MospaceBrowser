;(function () {
  'use strict'

  const profileId = __XUSS_PROFILE_ID__
  const fingerprintConfig = __XUSS_FINGERPRINT_CONFIG__
  const webglDebugVendor = 37445
  const webglDebugRenderer = 37446

  function overrideProperty(target, propertyName, getter) {
    const descriptorTarget =
      target && propertyName in target ? target : Object.getPrototypeOf(target)

    if (!descriptorTarget) {
      return
    }

    try {
      Object.defineProperty(descriptorTarget, propertyName, {
        get: getter,
        configurable: true
      })
    } catch (_error) {
      // Ignore pages that lock the descriptor.
    }
  }

  function createDeterministicNoise(index, noiseLevel) {
    const base = (index + 1) * (noiseLevel + 17)
    return (base % (noiseLevel * 2 + 1)) - noiseLevel
  }

  function addCanvasNoise(imageData, noiseLevel) {
    if (!noiseLevel || noiseLevel <= 0) {
      return imageData
    }

    const data = imageData.data

    for (let index = 0; index < data.length; index += 4) {
      const delta = createDeterministicNoise(index, noiseLevel)
      data[index] = Math.max(0, Math.min(255, data[index] + delta))
      data[index + 1] = Math.max(0, Math.min(255, data[index + 1] + delta))
      data[index + 2] = Math.max(0, Math.min(255, data[index + 2] + delta))
    }

    return imageData
  }

  function getPlatformLabel(platform) {
    if (platform === 'Win32') {
      return 'Windows'
    }

    if (platform === 'MacIntel') {
      return 'macOS'
    }

    if (platform.includes('Linux')) {
      return 'Linux'
    }

    return platform
  }

  function readWebGlInfo() {
    try {
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')

      if (!context) {
        return null
      }

      return {
        vendor: context.getParameter(webglDebugVendor),
        renderer: context.getParameter(webglDebugRenderer)
      }
    } catch (_error) {
      return null
    }
  }

  function buildVerificationReport() {
    return {
      profileId,
      applied: true,
      expected: {
        userAgent: fingerprintConfig.userAgent,
        platform: fingerprintConfig.software.platform,
        locale: fingerprintConfig.software.locale,
        languages: [fingerprintConfig.software.locale, 'en-US', 'en'],
        timezone: fingerprintConfig.software.timezone,
        cpuCores: fingerprintConfig.hardware.cpuCores,
        memory: fingerprintConfig.hardware.memory,
        screen: fingerprintConfig.hardware.screen,
        gpu: fingerprintConfig.hardware.gpu,
        doNotTrack: fingerprintConfig.software.doNotTrack ? '1' : null
      },
      observed: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        locale: navigator.language,
        languages: navigator.languages,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        cpuCores: navigator.hardwareConcurrency,
        memory: 'deviceMemory' in navigator ? navigator.deviceMemory : null,
        screen: {
          width: screen.width,
          height: screen.height,
          colorDepth: screen.colorDepth,
          pixelRatio: window.devicePixelRatio
        },
        gpu: readWebGlInfo(),
        doNotTrack: navigator.doNotTrack
      }
    }
  }

  overrideProperty(navigator, 'userAgent', () => fingerprintConfig.userAgent)
  overrideProperty(navigator, 'platform', () => fingerprintConfig.software.platform)
  overrideProperty(navigator, 'hardwareConcurrency', () => fingerprintConfig.hardware.cpuCores)
  overrideProperty(navigator, 'language', () => fingerprintConfig.software.locale)
  overrideProperty(navigator, 'languages', () => [fingerprintConfig.software.locale, 'en-US', 'en'])
  overrideProperty(navigator, 'doNotTrack', () =>
    fingerprintConfig.software.doNotTrack ? '1' : null
  )

  if ('deviceMemory' in navigator) {
    overrideProperty(navigator, 'deviceMemory', () => fingerprintConfig.hardware.memory)
  }

  overrideProperty(screen, 'width', () => fingerprintConfig.hardware.screen.width)
  overrideProperty(screen, 'height', () => fingerprintConfig.hardware.screen.height)
  overrideProperty(screen, 'availWidth', () => fingerprintConfig.hardware.screen.width)
  overrideProperty(screen, 'availHeight', () => fingerprintConfig.hardware.screen.height - 40)
  overrideProperty(screen, 'colorDepth', () => fingerprintConfig.hardware.screen.colorDepth)
  overrideProperty(screen, 'pixelDepth', () => fingerprintConfig.hardware.screen.colorDepth)
  overrideProperty(window, 'devicePixelRatio', () => fingerprintConfig.hardware.screen.pixelRatio)

  const OriginalDate = window.Date
  const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions
  const timezone = fingerprintConfig.software.timezone
  const locale = fingerprintConfig.software.locale

  function PatchedDate() {
    if (arguments.length === 0) {
      return new OriginalDate()
    }

    return Reflect.construct(OriginalDate, Array.from(arguments))
  }

  PatchedDate.prototype = OriginalDate.prototype
  PatchedDate.now = OriginalDate.now
  PatchedDate.parse = OriginalDate.parse
  PatchedDate.UTC = OriginalDate.UTC

  overrideProperty(window, 'Date', () => PatchedDate)

  const originalToLocaleString = OriginalDate.prototype.toLocaleString
  const originalToLocaleDateString = OriginalDate.prototype.toLocaleDateString
  const originalToLocaleTimeString = OriginalDate.prototype.toLocaleTimeString

  OriginalDate.prototype.toLocaleString = function (locales, options) {
    return originalToLocaleString.call(this, locale, { ...options, timeZone: timezone })
  }

  OriginalDate.prototype.toLocaleDateString = function (locales, options) {
    return originalToLocaleDateString.call(this, locale, { ...options, timeZone: timezone })
  }

  OriginalDate.prototype.toLocaleTimeString = function (locales, options) {
    return originalToLocaleTimeString.call(this, locale, { ...options, timeZone: timezone })
  }

  const OriginalDateTimeFormat = Intl.DateTimeFormat
  Intl.DateTimeFormat = function (requestedLocales, options) {
    return new OriginalDateTimeFormat(locale, { ...options, timeZone: timezone })
  }
  Intl.DateTimeFormat.prototype = OriginalDateTimeFormat.prototype
  Intl.DateTimeFormat.supportedLocalesOf = OriginalDateTimeFormat.supportedLocalesOf

  Intl.DateTimeFormat.prototype.resolvedOptions = function () {
    const options = originalResolvedOptions.call(this)
    return {
      ...options,
      locale,
      timeZone: timezone
    }
  }

  if (fingerprintConfig.advanced.canvasNoise > 0) {
    const noiseLevel = fingerprintConfig.advanced.canvasNoise
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL

    CanvasRenderingContext2D.prototype.getImageData = function () {
      const imageData = originalGetImageData.apply(this, arguments)
      return addCanvasNoise(imageData, noiseLevel)
    }

    HTMLCanvasElement.prototype.toDataURL = function () {
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = this.width
      tempCanvas.height = this.height

      const context = tempCanvas.getContext('2d')

      if (!context) {
        return originalToDataURL.apply(this, arguments)
      }

      context.drawImage(this, 0, 0)
      const imageData = context.getImageData(0, 0, this.width, this.height)
      context.putImageData(addCanvasNoise(imageData, noiseLevel), 0, 0)

      return originalToDataURL.apply(tempCanvas, arguments)
    }
  }

  const gpuVendor = fingerprintConfig.hardware.gpu.vendor
  const gpuRenderer = fingerprintConfig.hardware.gpu.renderer

  function patchWebGlContext(prototype) {
    if (!prototype || !prototype.getParameter) {
      return
    }

    const originalGetParameter = prototype.getParameter
    prototype.getParameter = function (parameter) {
      if (parameter === this.VENDOR || parameter === webglDebugVendor) {
        return gpuVendor
      }

      if (parameter === this.RENDERER || parameter === webglDebugRenderer) {
        return gpuRenderer
      }

      return originalGetParameter.call(this, parameter)
    }
  }

  patchWebGlContext(window.WebGLRenderingContext && WebGLRenderingContext.prototype)
  patchWebGlContext(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype)

  if (document.fonts && typeof document.fonts.check === 'function') {
    const originalCheck = document.fonts.check.bind(document.fonts)

    document.fonts.check = function (font) {
      const fontFamily = font.match(/(?:^|['"\s])([A-Za-z0-9\s-]+)(?:['"\s]|$)/)?.[1]?.trim()

      if (fontFamily && !fingerprintConfig.hardware.fonts.includes(fontFamily)) {
        return false
      }

      return originalCheck.apply(this, arguments)
    }
  }

  if (navigator.permissions && typeof navigator.permissions.query === 'function') {
    const originalQuery = navigator.permissions.query.bind(navigator.permissions)

    navigator.permissions.query = function (permissionDescriptor) {
      const permissionName =
        typeof permissionDescriptor === 'string' ? permissionDescriptor : permissionDescriptor.name

      if (permissionName === 'notifications') {
        return Promise.resolve({
          state: 'prompt',
          onchange: null,
          addEventListener: function () {},
          removeEventListener: function () {},
          dispatchEvent: function () {
            return true
          }
        })
      }

      return originalQuery(permissionDescriptor)
    }
  }

  const helper = {
    profileId,
    applied: true,
    label: getPlatformLabel(fingerprintConfig.software.platform),
    expected: {
      ...fingerprintConfig,
      hardware: {
        ...fingerprintConfig.hardware,
        fonts: fingerprintConfig.hardware.fonts.slice(0, 12)
      }
    },
    verify: buildVerificationReport
  }

  Object.defineProperty(window, '__xussFingerprint', {
    value: helper,
    configurable: true
  })

  if (document.documentElement) {
    document.documentElement.setAttribute('data-xuss-fingerprint', 'applied')
    document.documentElement.setAttribute('data-xuss-profile-id', profileId)
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      if (!document.documentElement) {
        return
      }

      document.documentElement.setAttribute('data-xuss-fingerprint', 'applied')
      document.documentElement.setAttribute('data-xuss-profile-id', profileId)
    })
  }
})()
