/** 
 * 插件原作者: @SanYi
 * 项目原地址: https://gitee.com/ThreeYi/sy_js_plugin
 * 二改优化: @DengFengLai(https://gitee.com/DengFengLai-F)
 * 使用教程：
 * 	  #下班：停止处理本群消息
 *    #上班：继续处理本群消息
 *    #开艾特：当前群命令仅艾特触发
 */
import common from '../../lib/common/common.js'
import YAML from 'yaml'
import fs from 'node:fs'

// 上班提示
const kaiqi_tip = segment.image('https://gchat.qpic.cn/gchatpic_new/0/0-0-3476B6EE5A325F800F1029C3319C3B87/0')
// 下班提示
const jinyong_tip = segment.image('https://gchat.qpic.cn/gchatpic_new/0/0-0-118DEF129CEAD0C785E7ED13969303C9/0')
// 无权限提示
const refuse_tip = segment.image('https://gchat.qpic.cn/gchatpic_new/0/0-0-3227FF42D7F43A01E82EADF507AEC490/0')
// 回避时间，单位秒
const huibi_time = 300
// 回避提示
const huibi_tip = `我先去做枣椰蜜糖啦，你们聊天吧，我们${huibi_time}秒后见-`
// 回来提示
const huilai_tip = '我做完回来啦，来和你们分享啦'
// 回来失败提示
const huilai_error = '啊，制作失败了，喊群主或者管理来开机吧'

// 配置文件路径，无特殊情况不要动
const file = './config/config/group.yaml'

export class Forbidden extends plugin {
  constructor () {
    super({
      name: 'syjs:上下班',
      dsc: '控制机器人在指定群开关',
      event: 'message',
      priority: 200, // 指令优先级
      rule: [
        {
          reg: '^#?(启用(本群)?|上班)|开机$', // 上班指令，可以改成自己想要的
          fnc: 'kaiqi'
        },
        {
          reg: '^#?(禁用(本群)?|下班)|关机$', // 下班指令，可以改成自己想要的
          fnc: 'jinyong'
        },
        {
          reg: '^#?回避$', // 回避指令，避免打扰群友聊天
          fnc: 'huibi'
        },
        {
          reg: '^#?开(at|艾特)', // 开启仅艾特触发
          fnc: 'at'
        }
      ]
    })
  }
  
  /**
   * 解析 YAML 文件并保留注释
   * @param {string} filePath - YAML 文件的路径
   * @returns {YAML.Document} 解析后的 YAML 文档对象
   */
  parseYAML(filePath) {
    const fileContent = fs.readFileSync(filePath, 'utf8')
    return YAML.parseDocument(fileContent)
  }

  /**
   * 将修改后的 YAML 文档写回文件
   * @param {string} filePath - YAML 文件的路径
   * @param {YAML.Document} document - 要写入的 YAML 文档对象
   */
  writeYAML(filePath, document) {
    const yamlString = document.toString()
    fs.writeFileSync(filePath, yamlString, 'utf8')
  }

  /**
   * 检查指定群是否处于开启状态
   * @param {Object} e - 消息事件
   * @returns {boolean} - 如果群组配置中 enable 属性为 null，则返回 true；否则返回 false
   */
  onOff(e) {
    let document = this.parseYAML(file)
    let data = document.toJSON()
    return data[e.group_id] && data[e.group_id].enable === null
  }
  
  /**
   * 下班，不处理群消息
   * @param {Object} e - 消息事件
   */
  async jinyong(e) {
    if (!(e.isMaster || e.member.is_admin || e.member.is_owner)) {
      return e.reply(refuse_tip)
    }
    if (e.isGroup) {
      let document = this.parseYAML(file)
      document.set(e.group_id, { enable: ['syjs:上下班'] })
      this.writeYAML(file, document)
      return e.reply(jinyong_tip)
    } else {
      return e.reply('请在群聊中使用')
    }
  }

  /**
   * 上班，继续处理群消息
   * @param {Object} e - 消息事件
   */
  async kaiqi(e) {
    if (!(e.isMaster || e.member.is_admin || e.member.is_owner)) {
      return e.reply(refuse_tip)
    }
    if (e.isGroup) {
      let document = this.parseYAML(file)
      document.set(e.group_id, { enable: null })
      this.writeYAML(file, document)
      return e.reply(kaiqi_tip)
    } else {
      return e.reply('请在群聊中使用')
    }
  }
  
  /**
   * 回避，规定时间内不处理消息
   * @param {Object} e - 消息事件
   */
  async huibi(e) {
    if (this.onOff(e)) {
      if (e.isGroup) {
        let document = this.parseYAML(file)
        document.set(e.group_id, { enable: ['syjs:上下班'] })
        this.writeYAML(file, document)
        e.reply(huibi_tip)
        await common.sleep(huibi_time * 1000)
        document = this.parseYAML(file)
        document.set(e.group_id, { enable: null })
        this.writeYAML(file, document)
        if (document.get(e.group_id).get('enable') === null) {
          e.reply(huilai_tip)
        } else {
          document = this.parseYAML(file)
          document.set(e.group_id, { enable: null })
          this.writeYAML(file, document)
          if (document.get(e.group_id).get('enable') === null) {
            return e.reply(huilai_tip)
          } else {
            return e.reply(huilai_error)
          }
        }
      }
    } else {
      e.reply('我已经是下班状态啦！')
      return false
    }
  }

  /**
   * 开at，指令需要艾特触发
   * @param {Object} e - 消息事件
   */
  async at(e) {
    if (!(e.isMaster || e.member.is_admin || e.member.is_owner)) {
      return e.reply(refuse_tip)
    }
    if (e.isGroup) {
      let document = this.parseYAML(file)
      document.set(e.group_id, { onlyReplyAt: 1 })
      this.writeYAML(file, document)
      return e.reply('已开启仅at和仅别名回复,at后开机即可解除此状态')
    } else {
      return e.reply('请在群聊中使用')
    }
  }
}