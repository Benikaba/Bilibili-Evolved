const fragmentSplitFactor = 12
class Batch {
  constructor () {
    this.itemList = []
    this.itemFilter = () => true
  }
  async getItemList() {}
  async collectData () {}
  async collectAria2 (quality, rpc) {
    const json = JSON.parse(await this.collectData(quality))
    if (rpc) {
      const option = settings.aria2RpcOption
      const { sendRpc } = await import('./aria2-rpc')
      for (const item of json) {
        const params = item.fragments.map((fragment, index) => {
          let indexNumber = ''
          if (item.fragments.length > 1) {
            indexNumber = ' - ' + (index + 1)
          }
          const params = []
          if (option.secretKey !== '') {
            params.push(`token:${option.secretKey}`)
          }
          params.push([fragment.url])
          params.push({
            referer: document.URL.replace(window.location.search, ''),
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:67.0) Gecko/20100101 Firefox/67.0',
            out: `${item.title}${indexNumber}.flv`,
            split: fragmentSplitFactor,
            dir: option.dir || undefined,
          })
          const id = encodeURIComponent(`${item.title}${indexNumber}`)
          return {
            params,
            id,
          }
        })
        await sendRpc(params, true)
      }
    } else {
      return `
# Generated by Bilibili Evolved Video Export
# https://github.com/the1812/Bilibili-Evolved/
${json.map(item => {
  return item.fragments.map(f => {
    return `
${f.url}
  referer=${item.referer}
  user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:67.0) Gecko/20100101 Firefox/67.0
  out=${item.title}.flv
  split=${fragmentSplitFactor}
   `.trim()
        })
      }).join('\n')}
      `.trim()
    }
  }
}
class VideoEpisodeBatch extends Batch {
  static async test () {
    if (!document.URL.includes('/www.bilibili.com/video/av')) {
      return false
    }
    return await SpinQuery.select('#multi_page') !== null
  }
  async getItemList() {
    if (this.itemList.length > 0) {
      return this.itemList
    }
    const api = `https://api.bilibili.com/x/web-interface/view?aid=${unsafeWindow.aid}`
    const json = await Ajax.getJson(api)
    if (json.code !== 0) {
      Toast.error(`获取视频选集列表失败, message=${json.message}`, '批量下载')
      return ''
    }
    const pages = json.data.pages
    if (pages === undefined) {
      Toast.error(`获取视频选集列表失败, 没有找到选集信息.`, '批量下载')
      return ''
    }
    this.itemList = pages.map(page => {
      return {
        title: `P${page.page} ${page.part}`,
        cid: page.cid,
        aid: unsafeWindow.aid,
      }
    })
    return this.itemList
  }
  async collectData (quality) {
    const result = []
    for (const item of (await this.getItemList()).filter(this.itemFilter)) {
      const url = `https://api.bilibili.com/x/player/playurl?avid=${item.aid}&cid=${item.cid}&qn=${quality}&otype=json`
      const json = await Ajax.getJsonWithCredentials(url)
      const data = json.data || json.result || json
      if (data.quality !== quality) {
        console.warn(`${item.title} 不支持所选画质, 已回退到较低画质. (quality=${data.quality})`)
      }
      const fragments = data.durl.map(it => {
        return {
          length: it.length,
          size: it.size,
          url: it.url
        }
      })
      result.push({
        fragments,
        title: item.title,
        totalSize: fragments.map(it => it.size).reduce((acc, it) => acc + it),
        cid: item.cid,
        referer: document.URL.replace(window.location.search, '')
      })
    }
    return JSON.stringify(result)
  }
}
class BangumiBatch extends Batch {
  static async test () {
    return document.URL.includes('/www.bilibili.com/bangumi')
  }
  async getItemList() {
    if (this.itemList.length > 0) {
      return this.itemList
    }
    const metaUrl = document.querySelector("meta[property='og:url']")
    if (metaUrl === null) {
      Toast.error('获取番剧数据失败: 无法找到 Season ID', '批量下载')
      return ''
    }
    const seasonId = metaUrl.getAttribute('content').match(/play\/ss(\d+)/)[1]
    if (seasonId === undefined) {
      Toast.error('获取番剧数据失败: 无法解析 Season ID', '批量下载')
      return ''
    }
    const json = await Ajax.getJson(`https://api.bilibili.com/pgc/web/season/section?season_id=${seasonId}`)
    if (json.code !== 0) {
      Toast.error(`获取番剧数据失败: 无法获取番剧集数列表, message=${json.message}`, '批量下载')
      return ''
    }
    this.itemList = json.result.main_section.episodes.map((it, index) => {
      return {
        aid: it.aid,
        cid: it.cid,
        title: it.long_title ? `${it.title} - ${it.long_title}` : `${index + 1} - ${it.title}`,
      }
    })
    return this.itemList
  }
  async collectData (quality) {
    const result = []
    for (const item of (await this.getItemList()).filter(this.itemFilter)) {
      const url = `https://api.bilibili.com/pgc/player/web/playurl?avid=${item.aid}&cid=${item.cid}&qn=${quality}&otype=json`
      const json = await Ajax.getJsonWithCredentials(url)
      const data = json.data || json.result || json
      if (data.quality !== quality) {
        console.warn(`${item.title} 不支持所选画质, 已回退到较低画质. (quality=${data.quality})`)
      }
      const fragments = data.durl.map(it => {
        return {
          length: it.length,
          size: it.size,
          url: it.url
        }
      })
      result.push({
        fragments,
        title: item.title,
        totalSize: fragments.map(it => it.size).reduce((acc, it) => acc + it),
        cid: item.cid,
        referer: document.URL.replace(window.location.search, '')
      })
    }
    return JSON.stringify(result)
  }
}
const extractors = [BangumiBatch, VideoEpisodeBatch]
let ExtractorClass = null
export class BatchExtractor {
  constructor() {
    this.itemFilter = () => true
  }
  static async test () {
    for (const e of extractors) {
      if (await e.test() === true) {
        ExtractorClass = e
        return true
      }
    }
    ExtractorClass = null
    return false
  }
  getExtractor () {
    if (ExtractorClass === null) {
      logError('[批量下载] 未找到合适的解析模块.')
      throw new Error(`[Batch Download] module not found.`)
    }
    const extractor = new ExtractorClass()
    extractor.itemFilter = this.itemFilter
    return extractor
  }
  async getItemList () {
    const extractor = this.getExtractor()
    return await extractor.getItemList()
  }
  async collectData (format, toast) {
    const extractor = this.getExtractor()
    const result = await extractor.collectData(format.quality)
    toast.dismiss()
    return result
  }
  async collectAria2 (format, toast, rpc) {
    const extractor = this.getExtractor()
    const result = await extractor.collectAria2(format.quality, rpc)
    toast.dismiss()
    return result
  }
}
export default {
  export: {
    BatchExtractor
  }
}
