'use strict'
import contentDisposition from 'content-disposition'
import crypto from 'crypto'
import fs from 'fs'
import http, { IncomingHttpHeaders, IncomingMessage } from 'http'
import path from 'path'
import tar from 'tar'
import unzip from 'unzip-stream'
import { URL } from 'url'
import { v1 as uuidv1 } from 'uuid'
import { CancellationToken } from 'vscode-languageserver-protocol'
import { FetchOptions, getRequestModule, resolveRequestOptions, toURL } from './fetch'
const logger = require('../util/logger')('model-download')

export interface DownloadOptions extends Omit<FetchOptions, 'buffer'> {
  /**
   * Folder that contains downloaded file or extracted files by untar or unzip
   */
  dest: string
  /**
   * algorithm for check etag.
   */
  etagAlgorithm?: string
  /**
   * Remove the specified number of leading path elements for *untar* only, default to `1`.
   */
  strip?: number
  /**
   * If true, use untar for `.tar.gz` filename
   */
  extract?: boolean | 'untar' | 'unzip'
  onProgress?: (percent: string) => void
  agent?: http.Agent
}

export function getEtag(headers: IncomingHttpHeaders): string | undefined {
  let header = headers['etag']
  if (typeof header !== 'string') return undefined
  header = header.replace(/^W\//, '')
  if (!header.startsWith('"') || !header.endsWith('"')) return undefined
  return header.slice(1, -1)
}

/**
 * Download file from url, with optional untar/unzip support.
 *
 * @param {string} url
 * @param {DownloadOptions} options contains dest folder and optional onProgress callback
 */
export default function download(urlInput: string | URL, options: DownloadOptions, token?: CancellationToken): Promise<string> {
  let url = toURL(urlInput)
  let { etagAlgorithm } = options
  let { dest, onProgress, extract } = options
  if (!dest || !path.isAbsolute(dest)) {
    throw new Error(`Expect absolute file path for dest option.`)
  }
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  } else {
    let stat = fs.statSync(dest)
    if (stat && !stat.isDirectory()) {
      throw new Error(`${dest} exists, but not directory!`)
    }
  }
  let mod = getRequestModule(url)
  let opts = resolveRequestOptions(url, options)
  if (!opts.agent && options.agent) opts.agent = options.agent
  let extname = path.extname(url.pathname)
  let finished = false
  return new Promise<string>((resolve, reject) => {
    if (token) {
      let disposable = token.onCancellationRequested(() => {
        disposable.dispose()
        req.destroy(new Error('request aborted'))
      })
    }
    let timer: NodeJS.Timer
    const req = mod.request(opts, (res: IncomingMessage) => {
      if ((res.statusCode >= 200 && res.statusCode < 300) || res.statusCode === 1223) {
        let headers = res.headers ?? {}
        let dispositionHeader = headers['content-disposition']
        let etag = getEtag(headers)
        let checkEtag = etag && typeof etagAlgorithm === 'string'
        if (!extname && dispositionHeader) {
          let disposition = contentDisposition.parse(dispositionHeader)
          if (disposition.parameters?.filename) {
            extname = path.extname(disposition.parameters.filename)
          }
        }
        if (extract === true) {
          if (extname === '.zip' || headers['content-type'] == 'application/zip') {
            extract = 'unzip'
          } else if (extname == '.tgz') {
            extract = 'untar'
          } else {
            reject(new Error(`Unable to detect extract method for ${url}`))
            return
          }
        }
        let total = Number(headers['content-length'])
        let hasTotal = !isNaN(total)
        let cur = 0
        res.on('error', err => {
          reject(new Error(`Unable to connect ${url}: ${err.message}`))
        })
        let hash = checkEtag ? crypto.createHash(etagAlgorithm) : undefined
        res.on('data', chunk => {
          cur += chunk.length
          if (hash) hash.update(chunk)
          if (hasTotal) {
            let percent = (cur / total * 100).toFixed(1)
            typeof onProgress === 'function' ? onProgress(percent) : logger.info(`Download ${url} progress ${percent}%`)
          }
        })
        res.on('end', () => {
          if (finished) return
          clearTimeout(timer)
          timer = undefined
          logger.info('Download completed:', url)
        })
        let stream: any
        if (extract === 'untar') {
          stream = res.pipe(tar.x({ strip: options.strip ?? 1, C: dest }))
        } else if (extract === 'unzip') {
          stream = res.pipe(unzip.Extract({ path: dest }))
        } else {
          dest = path.join(dest, `${uuidv1()}${extname}`)
          stream = res.pipe(fs.createWriteStream(dest))
        }
        stream.on('finish', () => {
          if (finished) return
          if (hash) {
            if (hash.digest('hex') !== etag) {
              reject(new Error(`Etag check failed by ${etagAlgorithm}, content not match.`))
              return
            }
          }
          logger.info(`Downloaded ${url} => ${dest}`)
          setTimeout(() => {
            resolve(dest)
          }, 100)
        })
        stream.on('error', reject)
      } else {
        reject(new Error(`Invalid response from ${url}: ${res.statusCode}`))
      }
    })
    req.on('error', e => {
      // Possible succeed proxy request with ECONNRESET error on node > 14
      if (opts.agent && e['code'] == 'ECONNRESET') {
        timer = setTimeout(() => {
          finished = true
          reject(e)
        }, 500)
      } else {
        clearTimeout(timer)
        if (opts.agent && opts.agent.proxy) {
          reject(new Error(`Request failed using proxy ${opts.agent.proxy.host}: ${e.message}`))
          return
        }
        finished = true
        reject(e)
      }
    })
    req.on('timeout', () => {
      req.destroy(new Error(`request timeout after ${options.timeout}ms`))
    })
    if (typeof options.timeout === 'number' && options.timeout) {
      req.setTimeout(options.timeout)
    }
    req.end()
  })
}
