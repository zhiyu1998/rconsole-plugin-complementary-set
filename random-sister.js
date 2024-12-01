import plugin from '../../lib/plugins/plugin.js'

export class example extends plugin {
  constructor () {
    super({
      name: '[R插件补集]小姐姐视频',
      dsc: '发送随机小姐姐视频',
      // 匹配的消息类型，参考https://oicqjs.github.io/oicq/#events
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: "随机小姐姐",
          fnc: 'start'
        }
      ]
    })
  }

  async start(e) {
    e.reply(segment.video('https://api.lolimi.cn/API/xjj/xjj.php'))
    return true
}
}
