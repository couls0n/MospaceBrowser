;(function () {
  'use strict'

  const profileId = __XUSS_PROFILE_ID__
  const fingerprintConfig = __XUSS_FINGERPRINT_CONFIG__
  const helperSymbol = Symbol.for(`__xuss.fingerprint.${profileId}`)
  const webglDebugVendor = 37445
  const webglDebugRenderer = 37446
  const nativeToString = Function.prototype.toString
  const nativeSourceMap = new WeakMap()
  const audioMutationMap = new WeakMap()
  const locale = fingerprintConfig.software.locale
  const timezone = fingerprintConfig.software.timezone
  const languages = buildLanguages(locale)
  const platformLabel = getClientHintPlatform()
  const platformVersion = getClientHintPlatformVersion()
  const browserVersion = extractBrowserVersion(fingerprintConfig.userAgent) || '142.0.7444.175'
  const userAgentBrands = parseSecChUaBrands(fingerprintConfig.secChUa)
  const rectNoiseX = createNoiseValue('clientrects:x', 0.001)
  const rectNoiseY = createNoiseValue('clientrects:y', 0.001)
  const textMetricNoise = createNoiseValue('measure-text', 0.00001)

  function rememberNativeSource(fn, source) {
    if (typeof fn === 'function') {
      nativeSourceMap.set(fn, source)
    }

    return fn
  }

  function installNativeToStringPatch() {
    const patchedToString = rememberNativeSource(function toString() {
      if (nativeSourceMap.has(this)) {
        return nativeSourceMap.get(this)
      }

      return nativeToString.call(this)
    }, 'function toString() { [native code] }')

    Object.defineProperty(Function.prototype, 'toString', {
      value: patchedToString,
      configurable: true,
      writable: true
    })
  }

  function getNativeGetterSource(propertyName) {
    return `function get ${String(propertyName)}() { [native code] }`
  }

  function getNativeFunctionSource(functionName) {
    return `function ${functionName}() { [native code] }`
  }

  function getDescriptorTarget(target, propertyName) {
    if (!target) {
      return null
    }

    let current = target

    while (current) {
      const descriptor = Object.getOwnPropertyDescriptor(current, propertyName)
      if (descriptor) {
        return { owner: current, descriptor }
      }

      current = Object.getPrototypeOf(current)
    }

    return {
      owner: target,
      descriptor: null
    }
  }

  function overrideGetter(target, propertyName, getter) {
    const descriptorData = getDescriptorTarget(target, propertyName)

    if (!descriptorData?.owner) {
      return
    }

    rememberNativeSource(getter, getNativeGetterSource(propertyName))

    try {
      Object.defineProperty(descriptorData.owner, propertyName, {
        get: getter,
        set: descriptorData.descriptor?.set,
        enumerable: descriptorData.descriptor?.enumerable ?? false,
        configurable: true
      })
    } catch (_error) {
      // Ignore locked descriptors.
    }
  }

  function overrideValue(target, propertyName, value) {
    const descriptorData = getDescriptorTarget(target, propertyName)

    if (!descriptorData?.owner) {
      return
    }

    try {
      Object.defineProperty(descriptorData.owner, propertyName, {
        value,
        enumerable: descriptorData.descriptor?.enumerable ?? false,
        configurable: true,
        writable: descriptorData.descriptor?.writable ?? false
      })
    } catch (_error) {
      // Ignore locked descriptors.
    }
  }

  function wrapMethod(target, propertyName, createWrappedMethod) {
    if (!target) {
      return null
    }

    const originalMethod = target[propertyName]

    if (typeof originalMethod !== 'function') {
      return null
    }

    const wrappedMethod = createWrappedMethod(originalMethod)
    rememberNativeSource(wrappedMethod, getNativeFunctionSource(propertyName))

    try {
      Object.defineProperty(target, propertyName, {
        value: wrappedMethod,
        enumerable: false,
        configurable: true,
        writable: true
      })
      return wrappedMethod
    } catch (_error) {
      return null
    }
  }

  function stringHash(input) {
    let hash = 2166136261

    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }

    return hash >>> 0
  }

  function createNoiseValue(label, amplitude) {
    const normalized = stringHash(`${profileId}:${label}`) / 0xffffffff - 0.5
    return normalized * amplitude * 2
  }

  function createUnitNoise(label) {
    return stringHash(`${profileId}:${label}`) & 1
  }

  function extractBrowserVersion(userAgent) {
    const match = userAgent.match(/(?:Chrome|Edg|OPR|Vivaldi)\/([\d.]+)/)
    return match ? match[1] : null
  }

  function parseSecChUaBrands(secChUa) {
    const fullVersion = browserVersion
    const majorVersion = fullVersion.split('.')[0] || '142'
    const matcher = /"([^"]+)"\s*;\s*v="([^"]+)"/g
    const brands = []
    let match = matcher.exec(secChUa || '')

    while (match) {
      const brand = match[1]
      const isGreaseBrand = /not/i.test(brand) && /brand/i.test(brand)
      brands.push({
        brand,
        version: isGreaseBrand ? '8' : majorVersion,
        fullVersion: isGreaseBrand ? '8.0.0.0' : fullVersion
      })
      match = matcher.exec(secChUa || '')
    }

    if (!brands.length) {
      brands.push(
        { brand: 'Not_A Brand', version: '8', fullVersion: '8.0.0.0' },
        { brand: 'Chromium', version: majorVersion, fullVersion },
        { brand: getBrowserBrand(), version: majorVersion, fullVersion }
      )
    }

    return brands
  }

  function getBrowserBrand() {
    if (fingerprintConfig.userAgent.includes('Edg/')) {
      return 'Microsoft Edge'
    }

    if (fingerprintConfig.userAgent.includes('OPR/')) {
      return 'Opera'
    }

    if (fingerprintConfig.userAgent.includes('Vivaldi/')) {
      return 'Vivaldi'
    }

    return 'Google Chrome'
  }

  function buildLanguages(primaryLocale) {
    const language = primaryLocale.split('-')[0]
    return Array.from(new Set([primaryLocale, language, 'en-US', 'en'].filter(Boolean)))
  }

  function getClientHintPlatform() {
    if (fingerprintConfig.software.platform === 'MacIntel') {
      return 'macOS'
    }

    if (fingerprintConfig.software.platform.includes('Linux')) {
      return 'Linux'
    }

    return 'Windows'
  }

  function getClientHintPlatformVersion() {
    if (platformLabel === 'macOS') {
      return '15.5.0'
    }

    if (platformLabel === 'Linux') {
      return '6.14.0'
    }

    return fingerprintConfig.userAgent.includes('Windows NT 10.0') ? '15.0.0' : '10.0.0'
  }

  function getArchitecture() {
    return /arm|aarch64/i.test(fingerprintConfig.userAgent) ? 'arm' : 'x86'
  }

  function getBitness() {
    return /x64|Win64|x86_64/i.test(fingerprintConfig.userAgent) ? '64' : '32'
  }

  function cloneBrandList() {
    return userAgentBrands.map((brand) => ({
      brand: brand.brand,
      version: brand.version
    }))
  }

  function buildHighEntropyValues(hints) {
    const availableValues = {
      architecture: getArchitecture(),
      bitness: getBitness(),
      brands: cloneBrandList(),
      fullVersionList: userAgentBrands.map((brand) => ({
        brand: brand.brand,
        version: brand.fullVersion
      })),
      mobile: false,
      model: '',
      platform: platformLabel,
      platformVersion,
      uaFullVersion: browserVersion,
      wow64: false
    }

    if (!Array.isArray(hints) || !hints.length) {
      return availableValues
    }

    return hints.reduce((result, hint) => {
      if (hint in availableValues) {
        result[hint] = availableValues[hint]
      }

      return result
    }, {})
  }

  function buildUserAgentData() {
    const prototype =
      typeof NavigatorUAData !== 'undefined' && NavigatorUAData.prototype
        ? NavigatorUAData.prototype
        : Object.prototype
    const userAgentData = Object.create(prototype)
    const getHighEntropyValues = rememberNativeSource(
      function getHighEntropyValues(hints) {
        return Promise.resolve(buildHighEntropyValues(hints))
      },
      getNativeFunctionSource('getHighEntropyValues')
    )
    const toJSON = rememberNativeSource(
      function toJSON() {
        return {
          brands: cloneBrandList(),
          mobile: false,
          platform: platformLabel
        }
      },
      getNativeFunctionSource('toJSON')
    )

    Object.defineProperties(userAgentData, {
      brands: {
        get: rememberNativeSource(function () {
          return cloneBrandList()
        }, getNativeGetterSource('brands')),
        enumerable: true,
        configurable: true
      },
      mobile: {
        get: rememberNativeSource(function () {
          return false
        }, getNativeGetterSource('mobile')),
        enumerable: true,
        configurable: true
      },
      platform: {
        get: rememberNativeSource(function () {
          return platformLabel
        }, getNativeGetterSource('platform')),
        enumerable: true,
        configurable: true
      },
      getHighEntropyValues: {
        value: getHighEntropyValues,
        enumerable: false,
        configurable: true,
        writable: true
      },
      toJSON: {
        value: toJSON,
        enumerable: false,
        configurable: true,
        writable: true
      }
    })

    return userAgentData
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
        languages,
        timezone: fingerprintConfig.software.timezone,
        cpuCores: fingerprintConfig.hardware.cpuCores,
        memory: fingerprintConfig.hardware.memory,
        screen: fingerprintConfig.hardware.screen,
        gpu: fingerprintConfig.hardware.gpu,
        doNotTrack: fingerprintConfig.software.doNotTrack ? '1' : null,
        webdriver: false,
        userAgentData: {
          brands: cloneBrandList(),
          mobile: false,
          platform: platformLabel
        }
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
        doNotTrack: navigator.doNotTrack,
        webdriver: navigator.webdriver,
        userAgentData: navigator.userAgentData ? navigator.userAgentData.toJSON() : null
      }
    }
  }

  function getAppVersion() {
    return fingerprintConfig.userAgent.replace(/^Mozilla\//, '')
  }

  function getVendor() {
    if (fingerprintConfig.userAgent.includes('Edg/')) {
      return 'Google Inc.'
    }

    return 'Google Inc.'
  }

  function mutatePixelBuffer(buffer, width, height, key, bytesPerPixel) {
    if (!buffer || !width || !height || !bytesPerPixel) {
      return
    }

    const maxPixels = Math.min(
      12,
      Math.max(2, Math.floor((width * height) / 128), fingerprintConfig.advanced.canvasNoise + 1)
    )
    const visited = new Set()

    for (let index = 0; index < maxPixels; index += 1) {
      const x = stringHash(`${key}:x:${index}`) % width
      const y = stringHash(`${key}:y:${index}`) % height
      const pixelIndex = y * width + x

      if (visited.has(pixelIndex)) {
        continue
      }

      visited.add(pixelIndex)

      const baseIndex = pixelIndex * bytesPerPixel

      if (baseIndex + Math.min(3, bytesPerPixel) > buffer.length) {
        continue
      }

      const red = buffer[baseIndex]
      const green = bytesPerPixel > 1 ? buffer[baseIndex + 1] : red
      const blue = bytesPerPixel > 2 ? buffer[baseIndex + 2] : red

      if (
        (red === 0 && green === 0 && blue === 0) ||
        (red === 255 && green === 255 && blue === 255)
      ) {
        continue
      }

      for (let channel = 0; channel < Math.min(3, bytesPerPixel); channel += 1) {
        const channelIndex = baseIndex + channel
        const current = buffer[channelIndex]

        if (current === 0 || current === 255) {
          continue
        }

        buffer[channelIndex] = (current & 0xfe) | createUnitNoise(`${key}:${index}:${channel}`)
      }
    }
  }

  function addCanvasNoise(imageData, key) {
    if (!imageData || !imageData.data || !fingerprintConfig.advanced.canvasNoise) {
      return imageData
    }

    mutatePixelBuffer(imageData.data, imageData.width, imageData.height, key, 4)
    return imageData
  }

  function cloneCanvasWithNoise(sourceCanvas, key) {
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = sourceCanvas.width
    tempCanvas.height = sourceCanvas.height

    const context = tempCanvas.getContext('2d')

    if (!context) {
      return sourceCanvas
    }

    context.drawImage(sourceCanvas, 0, 0)

    try {
      const imageData = context.getImageData(0, 0, tempCanvas.width, tempCanvas.height)
      context.putImageData(addCanvasNoise(imageData, key), 0, 0)
    } catch (_error) {
      return sourceCanvas
    }

    return tempCanvas
  }

  function shiftRect(rect, key) {
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      return rect
    }

    const xOffset = rectNoiseX + createNoiseValue(`${key}:x`, 0.0002)
    const yOffset = rectNoiseY + createNoiseValue(`${key}:y`, 0.0002)
    return new DOMRect(rect.x + xOffset, rect.y + yOffset, rect.width, rect.height)
  }

  function createRectListProxy(list, key) {
    if (!list || typeof list.length !== 'number') {
      return list
    }

    const item = rememberNativeSource(
      function item(index) {
        const rect =
          typeof list.item === 'function'
            ? list.item(index)
            : typeof index === 'number'
              ? list[index]
              : null

        return rect ? shiftRect(rect, `${key}:${index}`) : null
      },
      getNativeFunctionSource('item')
    )

    const iterator = rememberNativeSource(
      function values() {
        let index = 0

        return {
          next: function next() {
            if (index >= list.length) {
              return { done: true, value: undefined }
            }

            const value = item(index)
            index += 1
            return { done: false, value }
          }
        }
      },
      getNativeFunctionSource('values')
    )

    return new Proxy(list, {
      get(target, property, receiver) {
        if (property === 'item') {
          return item
        }

        if (property === Symbol.iterator) {
          return iterator
        }

        if (typeof property === 'string' && /^\d+$/.test(property)) {
          return item(Number(property))
        }

        return Reflect.get(target, property, receiver)
      }
    })
  }

  function createTextMetricsProxy(metrics, text) {
    if (!metrics || !text) {
      return metrics
    }

    const noiseFields = new Set([
      'width',
      'actualBoundingBoxAscent',
      'actualBoundingBoxDescent',
      'actualBoundingBoxLeft',
      'actualBoundingBoxRight',
      'fontBoundingBoxAscent',
      'fontBoundingBoxDescent',
      'emHeightAscent',
      'emHeightDescent',
      'hangingBaseline',
      'alphabeticBaseline',
      'ideographicBaseline'
    ])

    return new Proxy(metrics, {
      get(target, property, receiver) {
        if (noiseFields.has(property) && typeof target[property] === 'number') {
          const noise = createNoiseValue(`${text}:${String(property)}`, Math.abs(textMetricNoise))
          return target[property] + noise
        }

        return Reflect.get(target, property, receiver)
      }
    })
  }

  function getAudioMutationState(buffer) {
    if (!audioMutationMap.has(buffer)) {
      audioMutationMap.set(buffer, new Set())
    }

    return audioMutationMap.get(buffer)
  }

  function applyAudioNoise(samples, channelNumber, startOffset) {
    if (
      !fingerprintConfig.advanced.audioNoise ||
      !samples ||
      typeof samples.length !== 'number' ||
      samples.length < 32
    ) {
      return samples
    }

    const changeCount = Math.min(12, Math.max(4, Math.floor(samples.length / 5000)))

    for (let index = 0; index < changeCount; index += 1) {
      const sampleIndex = stringHash(
        `${profileId}:audio:${channelNumber}:${startOffset}:${index}`
      ) % samples.length
      const noise = createNoiseValue(
        `audio:${channelNumber}:${startOffset}:${index}`,
        0.000002
      )
      samples[sampleIndex] += noise
    }

    return samples
  }

  function createPermissionStatusShim(state) {
    const prototype =
      typeof PermissionStatus !== 'undefined' && PermissionStatus.prototype
        ? PermissionStatus.prototype
        : EventTarget.prototype
    const status = Object.create(prototype)

    overrideGetter(status, 'state', rememberNativeSource(function () {
      return state
    }, getNativeGetterSource('state')))

    if (!status.addEventListener) {
      status.addEventListener = function () {}
    }

    if (!status.removeEventListener) {
      status.removeEventListener = function () {}
    }

    if (!status.dispatchEvent) {
      status.dispatchEvent = function () {
        return true
      }
    }

    return status
  }

  function getNoisedSpeechVoices(voices) {
    if (
      !fingerprintConfig.advanced.speechVoicesNoise ||
      !Array.isArray(voices) ||
      voices.length < 2
    ) {
      return voices
    }

    const preferredLanguage = languages[0] || locale
    const matching = []
    const remaining = []

    for (const voice of voices) {
      if (voice && typeof voice.lang === 'string' && voice.lang.toLowerCase() === preferredLanguage.toLowerCase()) {
        matching.push(voice)
      } else {
        remaining.push(voice)
      }
    }

    const rotated = remaining.slice()

    for (let index = rotated.length - 1; index > 0; index -= 1) {
      const swapIndex = stringHash(`${profileId}:speech:${index}`) % (index + 1)
      const current = rotated[index]
      rotated[index] = rotated[swapIndex]
      rotated[swapIndex] = current
    }

    return [...matching, ...rotated]
  }

  installNativeToStringPatch()

  overrideGetter(navigator, 'userAgent', function () {
    return fingerprintConfig.userAgent
  })
  overrideGetter(navigator, 'appVersion', function () {
    return getAppVersion()
  })
  overrideGetter(navigator, 'platform', function () {
    return fingerprintConfig.software.platform
  })
  overrideGetter(navigator, 'vendor', function () {
    return getVendor()
  })
  overrideGetter(navigator, 'hardwareConcurrency', function () {
    return fingerprintConfig.hardware.cpuCores
  })
  overrideGetter(navigator, 'language', function () {
    return locale
  })
  overrideGetter(navigator, 'languages', function () {
    return languages.slice()
  })
  overrideGetter(navigator, 'doNotTrack', function () {
    return fingerprintConfig.software.doNotTrack ? '1' : null
  })
  overrideGetter(navigator, 'webdriver', function () {
    return false
  })
  overrideGetter(navigator, 'maxTouchPoints', function () {
    return 0
  })

  if ('deviceMemory' in navigator) {
    overrideGetter(navigator, 'deviceMemory', function () {
      return fingerprintConfig.hardware.memory
    })
  }

  overrideGetter(navigator, 'userAgentData', function () {
    return buildUserAgentData()
  })

  overrideGetter(screen, 'width', function () {
    return fingerprintConfig.hardware.screen.width
  })
  overrideGetter(screen, 'height', function () {
    return fingerprintConfig.hardware.screen.height
  })
  overrideGetter(screen, 'availWidth', function () {
    return fingerprintConfig.hardware.screen.width
  })
  overrideGetter(screen, 'availHeight', function () {
    return Math.max(0, fingerprintConfig.hardware.screen.height - 40)
  })
  overrideGetter(screen, 'colorDepth', function () {
    return fingerprintConfig.hardware.screen.colorDepth
  })
  overrideGetter(screen, 'pixelDepth', function () {
    return fingerprintConfig.hardware.screen.colorDepth
  })
  overrideGetter(window, 'devicePixelRatio', function () {
    return fingerprintConfig.hardware.screen.pixelRatio
  })

  if (Intl.DateTimeFormat && Intl.DateTimeFormat.prototype) {
    wrapMethod(Intl.DateTimeFormat.prototype, 'resolvedOptions', (originalMethod) =>
      function resolvedOptions() {
        const options = originalMethod.apply(this, arguments)

        return {
          ...options,
          locale,
          timeZone: timezone
        }
      }
    )
  }

  wrapMethod(Date.prototype, 'toLocaleString', (originalMethod) =>
    function toLocaleString(requestedLocales, options) {
      return originalMethod.call(this, requestedLocales || locale, {
        ...options,
        timeZone: timezone
      })
    }
  )

  wrapMethod(Date.prototype, 'toLocaleDateString', (originalMethod) =>
    function toLocaleDateString(requestedLocales, options) {
      return originalMethod.call(this, requestedLocales || locale, {
        ...options,
        timeZone: timezone
      })
    }
  )

  wrapMethod(Date.prototype, 'toLocaleTimeString', (originalMethod) =>
    function toLocaleTimeString(requestedLocales, options) {
      return originalMethod.call(this, requestedLocales || locale, {
        ...options,
        timeZone: timezone
      })
    }
  )

  if (fingerprintConfig.advanced.canvasNoise > 0) {
    wrapMethod(CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, 'getImageData', (originalMethod) =>
      function getImageData(sx, sy, sw, sh) {
        const imageData = originalMethod.apply(this, arguments)
        return addCanvasNoise(imageData, `canvas:getImageData:${sw}x${sh}:${sx}:${sy}`)
      }
    )

    wrapMethod(HTMLCanvasElement && HTMLCanvasElement.prototype, 'toDataURL', (originalMethod) =>
      function toDataURL() {
        const noisedCanvas = cloneCanvasWithNoise(
          this,
          `canvas:toDataURL:${this.width}x${this.height}`
        )
        return originalMethod.apply(noisedCanvas, arguments)
      }
    )

    wrapMethod(HTMLCanvasElement && HTMLCanvasElement.prototype, 'toBlob', (originalMethod) =>
      function toBlob(callback, type, quality) {
        const noisedCanvas = cloneCanvasWithNoise(
          this,
          `canvas:toBlob:${this.width}x${this.height}`
        )
        return originalMethod.call(noisedCanvas, callback, type, quality)
      }
    )

    if (window.OffscreenCanvas && OffscreenCanvas.prototype) {
      wrapMethod(OffscreenCanvas.prototype, 'convertToBlob', (originalMethod) =>
        function convertToBlob(options) {
          return originalMethod.apply(this, arguments).then((blob) => blob)
        }
      )
    }
  }

  wrapMethod(CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, 'measureText', (originalMethod) =>
    function measureText(text) {
      const metrics = originalMethod.apply(this, arguments)
      return createTextMetricsProxy(metrics, String(text || ''))
    }
  )

  const gpuVendor = fingerprintConfig.hardware.gpu.vendor
  const gpuRenderer = fingerprintConfig.hardware.gpu.renderer

  function patchWebGlContext(prototype, contextLabel) {
    if (!prototype) {
      return
    }

    wrapMethod(prototype, 'getParameter', (originalMethod) =>
      function getParameter(parameter) {
        if (parameter === this.VENDOR || parameter === webglDebugVendor) {
          return gpuVendor
        }

        if (parameter === this.RENDERER || parameter === webglDebugRenderer) {
          return gpuRenderer
        }

        return originalMethod.call(this, parameter)
      }
    )

    if (fingerprintConfig.advanced.webglNoise) {
      wrapMethod(prototype, 'readPixels', (originalMethod) =>
        function readPixels(x, y, width, height, format, type, pixels) {
          const result = originalMethod.apply(this, arguments)

          if (pixels && typeof pixels.length === 'number' && width > 0 && height > 0) {
            let bytesPerPixel = 4

            if (format === this.RGB) {
              bytesPerPixel = 3
            } else if (format === this.ALPHA || format === this.LUMINANCE) {
              bytesPerPixel = 1
            }

            mutatePixelBuffer(
              pixels,
              width,
              height,
              `${contextLabel}:readPixels:${width}x${height}:${format}:${type}`,
              bytesPerPixel
            )
          }

          return result
        }
      )
    }
  }

  patchWebGlContext(window.WebGLRenderingContext && WebGLRenderingContext.prototype, 'webgl')
  patchWebGlContext(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype, 'webgl2')

  if (document.fonts) {
    wrapMethod(Object.getPrototypeOf(document.fonts), 'check', (originalMethod) =>
      function check(font) {
        const fontFamily = font
          .match(/(?:^|['"\s])([A-Za-z0-9\s-]+)(?:['"\s]|$)/)?.[1]
          ?.trim()

        if (fontFamily && !fingerprintConfig.hardware.fonts.includes(fontFamily)) {
          return false
        }

        return originalMethod.apply(this, arguments)
      }
    )
  }

  if (navigator.permissions && typeof navigator.permissions.query === 'function') {
    wrapMethod(Object.getPrototypeOf(navigator.permissions), 'query', (originalMethod) =>
      function query(permissionDescriptor) {
        const permissionName =
          typeof permissionDescriptor === 'string' ? permissionDescriptor : permissionDescriptor.name

        return Promise.resolve(originalMethod.apply(this, arguments))
          .then((status) => {
            if (permissionName === 'notifications' && status) {
              overrideGetter(status, 'state', function () {
                return Notification.permission === 'denied' ? 'denied' : 'prompt'
              })
            }

            return status
          })
          .catch((error) => {
            if (permissionName === 'notifications') {
              return createPermissionStatusShim(
                Notification.permission === 'denied' ? 'denied' : 'prompt'
              )
            }

            throw error
          })
      }
    )
  }

  if (fingerprintConfig.advanced.clientRectsNoise) {
    wrapMethod(Element && Element.prototype, 'getBoundingClientRect', (originalMethod) =>
      function getBoundingClientRect() {
        return shiftRect(originalMethod.apply(this, arguments), 'element:bounding')
      }
    )

    wrapMethod(Element && Element.prototype, 'getClientRects', (originalMethod) =>
      function getClientRects() {
        return createRectListProxy(originalMethod.apply(this, arguments), 'element:rects')
      }
    )

    wrapMethod(Range && Range.prototype, 'getBoundingClientRect', (originalMethod) =>
      function getBoundingClientRect() {
        return shiftRect(originalMethod.apply(this, arguments), 'range:bounding')
      }
    )

    wrapMethod(Range && Range.prototype, 'getClientRects', (originalMethod) =>
      function getClientRects() {
        return createRectListProxy(originalMethod.apply(this, arguments), 'range:rects')
      }
    )
  }

  if (window.AudioBuffer && AudioBuffer.prototype) {
    wrapMethod(AudioBuffer.prototype, 'getChannelData', (originalMethod) =>
      function getChannelData(channelNumber) {
        const data = originalMethod.apply(this, arguments)
        const mutationState = getAudioMutationState(this)

        if (!mutationState.has(channelNumber)) {
          applyAudioNoise(data, channelNumber, 0)
          mutationState.add(channelNumber)
        }

        return data
      }
    )

    wrapMethod(AudioBuffer.prototype, 'copyFromChannel', (originalMethod) =>
      function copyFromChannel(destination, channelNumber, startInChannel) {
        const result = originalMethod.apply(this, arguments)

        if (destination) {
          applyAudioNoise(destination, channelNumber, startInChannel || 0)
        }

        return result
      }
    )
  }

  if (window.speechSynthesis && typeof window.speechSynthesis.getVoices === 'function') {
    const prototype = Object.getPrototypeOf(window.speechSynthesis)

    wrapMethod(prototype, 'getVoices', (originalMethod) =>
      function getVoices() {
        const voices = originalMethod.apply(this, arguments)
        return getNoisedSpeechVoices(Array.isArray(voices) ? voices.slice() : voices)
      }
    )
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

  Object.defineProperty(window, helperSymbol, {
    value: helper,
    configurable: false,
    enumerable: false,
    writable: false
  })
})()
