#!/usr/bin/env python3
"""依《率土之濱》官方武將庫同步武將與戰法數值（以台服為準，台服沒有的武將/戰法再用網易官網補）。

產生：
  js/data/heroes.js   武將名單（保留本作名單與順序，官方有收錄者改用官方數值）
  js/data/skills.js   只改寫 // <official> … // </official> 之間的官方戰法區塊

資料來源：
  台服（遊戲橘子）武將圖鑑 https://stzb.gamedreamer.com.tw/plate.html 與戰法圖鑑 skill.html 使用的
    js/wjzl.js   武將：陣營、星級、統御、兵種、攻擊距離、四維與成長、攻城、自帶/可拆解戰法
    js/jzzl.js   戰法：類型、發動機率、品質、兵種限制、有效距離、說明（滿級 ** 一級）
  網易官網武將庫 https://stzb.163.com/card_list.html 使用的（簡體，轉為台灣繁體）
    hero_extra.json / skill_extra.json

卡圖不會被下載，只記錄來源與編號（tw:100451 / cn:100451），由本機版在瀏覽器執行時直接載入（見 js/cardart.js）。

用法：
  pip install opencc-python-reimplemented
  python3 tools/sync_official.py            # 從官網抓最新資料
  python3 tools/sync_official.py --cache D  # 使用 D 目錄內的快取檔（不存在時才下載並存入 D）
"""
import argparse
import json
import os
import re
import ssl
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CN_URL = 'https://g0.gph.netease.com/ngsocial/community/stzb/cfg/'
TW_URL = 'https://stzb.gamedreamer.com.tw/js/'
SOURCES = {
    'cn_hero': (CN_URL + 'hero_extra.json?gameid=g10', 'hero_extra.json', None),
    'cn_skill': (CN_URL + 'skill_extra.json?gameid=g10', 'skill_extra.json', None),
    'tw_hero': (TW_URL + 'wjzl.js', 'wjzl.js', 'wjzl'),
    'tw_skill': (TW_URL + 'jzzl.js', 'jzzl.js', 'jzzl'),
}

# ---------------------------------------------------------------------------
# 本作武將名單（舊版手調數值；官方查無此將時沿用）
# 名稱, 陣營, 星級, 統御, 兵種, 攻擊距離, 攻擊, 攻擊成長, 防禦, 防禦成長, 謀略, 謀略成長, 速度, 速度成長, 攻城, 自帶戰法
BASE = [
    ['呂布', '群', 5, 3.5, '騎', 2, 98, 2.9, 82, 1.9, 26, 0.5, 85, 2.0, 20, 'tianxiawushuang'],
    ['關羽', '蜀', 5, 3.5, '騎', 2, 96, 2.7, 90, 2.1, 60, 1.2, 70, 1.6, 30, 'weizhenhuaxia'],
    ['張飛', '蜀', 5, 3.5, '步', 2, 97, 2.8, 85, 2.0, 38, 0.6, 62, 1.5, 25, 'yanrenpaoxiao'],
    ['趙雲', '蜀', 5, 3.5, '騎', 3, 92, 2.5, 93, 2.4, 60, 1.3, 88, 2.1, 20, 'longdan'],
    ['諸葛亮', '蜀', 5, 3.5, '弓', 5, 38, 0.8, 82, 1.8, 100, 3.0, 70, 1.5, 10, 'caochuanjiejian'],
    ['劉備', '蜀', 5, 3.0, '弓', 4, 70, 1.6, 80, 1.9, 82, 2.0, 65, 1.4, 15, 'rendezaishi'],
    ['馬超', '群', 5, 3.5, '騎', 2, 98, 2.8, 78, 1.8, 32, 0.6, 90, 2.2, 20, 'xiliangtieji'],
    ['黃忠', '蜀', 5, 3.0, '弓', 5, 95, 2.7, 70, 1.6, 45, 0.9, 55, 1.2, 15, 'baibuchuanyang'],
    ['姜維', '蜀', 5, 3.5, '騎', 3, 88, 2.3, 82, 1.9, 88, 2.1, 76, 1.8, 20, 'wenwushuangquan'],
    ['龐統', '蜀', 5, 3.0, '弓', 4, 36, 0.7, 72, 1.6, 96, 2.8, 60, 1.3, 10, 'lianhuanji'],
    ['法正', '蜀', 5, 3.0, '弓', 4, 40, 0.8, 70, 1.6, 92, 2.6, 70, 1.6, 10, 'bingwuchangshi'],
    ['曹操', '魏', 5, 3.5, '騎', 3, 82, 2.0, 90, 2.2, 88, 2.2, 72, 1.6, 30, 'weiwuzhishi'],
    ['司馬懿', '魏', 5, 3.5, '步', 4, 50, 1.0, 88, 2.1, 100, 2.9, 60, 1.3, 10, 'yingshilanggu'],
    ['郭嘉', '魏', 5, 3.0, '弓', 5, 30, 0.6, 60, 1.3, 98, 2.9, 72, 1.7, 10, 'shimianmaifu'],
    ['荀彧', '魏', 5, 3.0, '步', 3, 30, 0.6, 80, 1.9, 95, 2.7, 60, 1.3, 10, 'wangzuozhicai'],
    ['典韋', '魏', 5, 3.5, '步', 2, 95, 2.7, 90, 2.2, 20, 0.3, 50, 1.1, 25, 'guzhielai'],
    ['許褚', '魏', 5, 3.5, '步', 2, 97, 2.8, 86, 2.0, 25, 0.4, 55, 1.2, 25, 'luoyixuezhan'],
    ['夏侯惇', '魏', 5, 3.5, '騎', 2, 90, 2.4, 92, 2.3, 50, 1.0, 70, 1.6, 20, 'bashidanjing'],
    ['張遼', '魏', 5, 3.5, '騎', 2, 93, 2.6, 83, 1.9, 70, 1.4, 82, 2.0, 20, 'weizhenxiaoyao'],
    ['賈詡', '群', 5, 3.0, '弓', 5, 42, 0.8, 70, 1.6, 97, 2.8, 66, 1.5, 10, 'luanwu'],
    ['周瑜', '吳', 5, 3.5, '弓', 5, 50, 1.0, 70, 1.6, 99, 2.9, 76, 1.8, 15, 'shenhuoji'],
    ['陸遜', '吳', 5, 3.5, '弓', 5, 45, 0.9, 72, 1.7, 97, 2.8, 78, 1.8, 15, 'huoshaolianying'],
    ['孫權', '吳', 5, 3.0, '弓', 4, 60, 1.3, 85, 2.0, 88, 2.1, 65, 1.4, 20, 'zuoduandongnan'],
    ['孫策', '吳', 5, 3.5, '騎', 2, 96, 2.7, 82, 1.9, 55, 1.1, 86, 2.1, 25, 'jiangdongxiaobawang'],
    ['甘寧', '吳', 5, 3.5, '騎', 2, 95, 2.7, 75, 1.7, 42, 0.8, 92, 2.3, 20, 'jinfanbailing'],
    ['太史慈', '吳', 5, 3.0, '騎', 3, 93, 2.6, 80, 1.8, 50, 1.0, 84, 2.0, 20, 'shenshe'],
    ['呂蒙', '吳', 5, 3.5, '步', 3, 80, 1.9, 82, 1.9, 90, 2.3, 68, 1.5, 20, 'baiyidujiang'],
    ['大喬', '吳', 5, 3.0, '弓', 4, 30, 0.6, 72, 1.7, 88, 2.2, 75, 1.8, 5, 'guose'],
    ['小喬', '吳', 5, 3.0, '弓', 4, 30, 0.6, 66, 1.5, 94, 2.6, 78, 1.9, 5, 'tianxiang'],
    ['孫尚香', '吳', 5, 3.0, '弓', 4, 90, 2.5, 70, 1.6, 50, 1.0, 88, 2.2, 15, 'gongyaoji'],
    ['張角', '群', 5, 3.5, '弓', 5, 30, 0.6, 72, 1.6, 99, 2.9, 60, 1.3, 10, 'huangtiantaiping'],
    ['貂蟬', '群', 5, 3.0, '弓', 4, 25, 0.5, 66, 1.5, 92, 2.6, 90, 2.2, 5, 'biyue'],
    ['董卓', '群', 5, 3.5, '騎', 2, 88, 2.2, 96, 2.5, 52, 1.0, 50, 1.0, 25, 'jiuchiroulin'],
    ['左慈', '漢', 5, 3.0, '步', 4, 30, 0.6, 78, 1.8, 96, 2.8, 72, 1.7, 10, 'qimendunjia'],
    ['華佗', '漢', 5, 3.0, '弓', 4, 20, 0.4, 76, 1.8, 90, 2.4, 70, 1.6, 5, 'qingnang'],
    ['蔡文姬', '漢', 5, 3.0, '弓', 4, 20, 0.4, 72, 1.7, 92, 2.5, 68, 1.6, 5, 'hujia'],
    ['高順', '群', 5, 3.0, '步', 2, 88, 2.3, 94, 2.4, 45, 0.9, 55, 1.2, 30, 'xianzhenying'],
    ['公孫瓚', '群', 5, 3.0, '騎', 2, 86, 2.3, 80, 1.8, 50, 1.0, 90, 2.3, 20, 'baimayicong'],
    ['盧植', '漢', 5, 3.0, '步', 3, 75, 1.7, 85, 2.0, 88, 2.2, 58, 1.2, 20, 'hanshiweiwang'],
    ['皇甫嵩', '漢', 5, 3.0, '騎', 2, 88, 2.3, 84, 2.0, 70, 1.5, 70, 1.6, 25, 'pozhencuijian'],
    ['黃月英', '蜀', 4, 2.5, '步', 3, 30, 0.6, 85, 2.1, 90, 2.3, 60, 1.3, 30, 'qixie'],
    ['徐庶', '蜀', 4, 2.5, '弓', 4, 55, 1.1, 70, 1.6, 88, 2.2, 66, 1.5, 10, 'zouma'],
    ['魏延', '蜀', 4, 3.0, '步', 2, 90, 2.4, 80, 1.8, 50, 1.0, 70, 1.6, 20, 'ziwuguqimou'],
    ['袁紹', '群', 4, 3.0, '弓', 4, 78, 1.8, 80, 1.9, 70, 1.5, 60, 1.3, 25, 'hebeiwangzu'],
    ['黃蓋', '吳', 4, 2.5, '步', 2, 80, 1.9, 82, 1.9, 70, 1.5, 50, 1.1, 20, 'kurouji'],
    ['周泰', '吳', 4, 3.0, '步', 2, 82, 2.0, 92, 2.4, 30, 0.5, 55, 1.2, 20, 'fenshenjiuzhu'],
    ['魯肅', '吳', 4, 2.5, '弓', 4, 40, 0.8, 76, 1.8, 90, 2.3, 62, 1.4, 10, 'tashangce'],
    ['曹仁', '魏', 4, 3.0, '步', 2, 80, 1.9, 94, 2.4, 50, 1.0, 50, 1.1, 25, 'shoucheng'],
    ['孟獲', '群', 4, 3.0, '步', 2, 90, 2.4, 88, 2.2, 20, 0.3, 50, 1.1, 25, 'nanmanwang'],
    ['祝融', '群', 4, 2.5, '步', 3, 88, 2.3, 76, 1.8, 40, 0.8, 80, 1.9, 20, 'huoshen'],
    ['關銀屏', '蜀', 4, 2.5, '步', 2, 85, 2.2, 78, 1.8, 50, 1.0, 80, 1.9, 15, 'jinguoyingxiong'],
    ['張寧', '群', 4, 2.5, '弓', 4, 35, 0.7, 65, 1.5, 88, 2.3, 80, 1.9, 10, 'shisanhuan'],
    ['顏良', '群', 4, 3.0, '騎', 2, 90, 2.4, 76, 1.7, 25, 0.4, 72, 1.7, 20, 'poqianjun'],
    ['文醜', '群', 4, 3.0, '騎', 2, 90, 2.4, 74, 1.7, 25, 0.4, 76, 1.8, 20, 'luanji'],
    ['夏侯淵', '魏', 4, 3.0, '騎', 3, 88, 2.3, 72, 1.6, 50, 1.0, 92, 2.3, 15, 'shibubenxin'],
    ['張郃', '魏', 4, 3.0, '騎', 2, 86, 2.2, 84, 2.0, 60, 1.2, 78, 1.8, 20, 'huchi'],
    ['徐晃', '魏', 4, 3.0, '步', 2, 88, 2.3, 84, 2.0, 45, 0.9, 60, 1.3, 30, 'zhenshe'],
    ['甄姬', '魏', 4, 2.5, '弓', 4, 25, 0.5, 66, 1.5, 90, 2.4, 72, 1.7, 5, 'kongluan'],
    ['王異', '魏', 4, 2.5, '弓', 4, 60, 1.3, 70, 1.6, 85, 2.1, 70, 1.6, 10, 'jiqiong'],
    ['程普', '吳', 4, 2.5, '步', 2, 78, 1.8, 86, 2.1, 65, 1.4, 55, 1.2, 20, 'tiebiwangu'],
    ['淩統', '吳', 4, 2.5, '騎', 2, 86, 2.2, 72, 1.6, 40, 0.8, 86, 2.1, 15, 'chongfeng'],
    ['丁奉', '吳', 4, 2.5, '步', 2, 84, 2.1, 78, 1.8, 50, 1.0, 66, 1.5, 20, 'luanji'],
    ['陳宮', '群', 4, 2.5, '弓', 4, 40, 0.8, 72, 1.6, 90, 2.3, 60, 1.3, 10, 'mouzhi'],
    ['何進', '漢', 4, 2.5, '騎', 2, 78, 1.8, 80, 1.9, 40, 0.8, 60, 1.3, 25, 'guwu'],
    ['朱儁', '漢', 4, 2.5, '步', 2, 80, 1.9, 82, 2.0, 60, 1.3, 55, 1.2, 25, 'jushou'],
    ['王允', '漢', 4, 2.5, '弓', 4, 30, 0.6, 66, 1.5, 88, 2.2, 60, 1.3, 10, 'zanbiqifeng'],
    ['龐德', '群', 4, 3.0, '騎', 2, 90, 2.4, 80, 1.8, 35, 0.6, 70, 1.6, 20, 'fenzhan'],
    ['張繡', '群', 4, 2.5, '騎', 2, 84, 2.1, 76, 1.7, 50, 1.0, 80, 1.9, 20, 'jiqu'],
    ['馬雲祿', '蜀', 4, 2.5, '騎', 2, 84, 2.1, 72, 1.6, 45, 0.9, 88, 2.2, 15, 'lianji'],
    ['嚴顏', '蜀', 4, 2.5, '步', 3, 80, 1.9, 86, 2.1, 55, 1.1, 50, 1.1, 25, 'jianshou'],
    ['李典', '魏', 4, 2.5, '步', 2, 76, 1.8, 82, 2.0, 70, 1.5, 58, 1.3, 20, 'yuanhu'],
    ['于禁', '魏', 4, 2.5, '步', 2, 80, 1.9, 86, 2.1, 55, 1.1, 55, 1.2, 20, 'jushou'],
    ['廖化', '蜀', 3, 2.0, '步', 2, 70, 1.6, 68, 1.5, 40, 0.8, 55, 1.2, 15, 'tuji'],
    ['周倉', '蜀', 3, 2.0, '步', 2, 74, 1.7, 66, 1.5, 20, 0.3, 50, 1.1, 15, 'yuanhu'],
    ['馬謖', '蜀', 3, 2.0, '弓', 4, 40, 0.8, 55, 1.2, 76, 1.8, 55, 1.2, 10, 'huogong'],
    ['潘璋', '吳', 3, 2.0, '騎', 2, 74, 1.7, 62, 1.4, 35, 0.6, 66, 1.5, 15, 'chongfeng'],
    ['蔣欽', '吳', 3, 2.0, '步', 2, 70, 1.6, 70, 1.6, 40, 0.8, 55, 1.2, 15, 'jianshou'],
    ['韓當', '吳', 3, 2.0, '弓', 4, 72, 1.7, 64, 1.4, 45, 0.9, 58, 1.3, 15, 'jijianfang'],
    ['臧霸', '群', 3, 2.0, '步', 2, 74, 1.7, 70, 1.6, 35, 0.6, 55, 1.2, 15, 'fenzhan'],
    ['華雄', '群', 3, 2.5, '騎', 2, 78, 1.8, 64, 1.4, 20, 0.3, 62, 1.4, 15, 'naojiu'],
    ['李傕', '群', 3, 2.0, '騎', 2, 72, 1.7, 60, 1.3, 40, 0.8, 64, 1.5, 15, 'luanji'],
    ['郭汜', '群', 3, 2.0, '騎', 2, 70, 1.6, 60, 1.3, 40, 0.8, 66, 1.5, 15, 'jiqu'],
    ['田豐', '群', 3, 2.0, '弓', 4, 30, 0.6, 55, 1.2, 80, 1.9, 50, 1.1, 10, 'ansha'],
    ['沮授', '群', 3, 2.0, '弓', 4, 35, 0.7, 58, 1.3, 78, 1.8, 52, 1.1, 10, 'mouzhi'],
    ['曹洪', '魏', 3, 2.0, '騎', 2, 72, 1.7, 72, 1.6, 35, 0.6, 60, 1.4, 15, 'jijiu'],
    ['樂進', '魏', 3, 2.5, '步', 2, 76, 1.8, 66, 1.5, 40, 0.8, 62, 1.4, 20, 'xiangong'],
    ['程昱', '魏', 3, 2.0, '弓', 4, 35, 0.7, 60, 1.3, 78, 1.8, 55, 1.2, 10, 'kongluan'],
    ['朱桓', '吳', 3, 2.0, '步', 2, 70, 1.6, 68, 1.5, 50, 1.0, 56, 1.2, 15, 'guwu'],
    ['陳武', '吳', 3, 2.0, '騎', 2, 72, 1.7, 64, 1.4, 30, 0.5, 62, 1.4, 15, 'tuji'],
    ['吳懿', '蜀', 3, 2.0, '騎', 2, 70, 1.6, 66, 1.5, 45, 0.9, 60, 1.3, 15, 'shensu'],
    ['馬忠', '蜀', 3, 2.0, '弓', 4, 68, 1.6, 60, 1.3, 45, 0.9, 60, 1.3, 15, 'jiaoxie'],
    ['張讓', '漢', 3, 2.0, '弓', 4, 25, 0.5, 55, 1.2, 76, 1.8, 58, 1.3, 5, 'jiqiong'],
    ['韓遂', '群', 3, 2.0, '騎', 2, 70, 1.6, 66, 1.5, 60, 1.3, 62, 1.4, 15, 'guwu'],
    ['閻行', '群', 3, 2.0, '騎', 2, 76, 1.8, 62, 1.4, 30, 0.5, 66, 1.5, 15, 'tuji'],
    ['于吉', '群', 3, 2.0, '弓', 4, 30, 0.6, 55, 1.2, 80, 1.9, 55, 1.2, 5, 'xiuzheng'],
    ['劉表', '群', 3, 2.0, '弓', 4, 45, 0.9, 66, 1.5, 70, 1.6, 45, 1.0, 20, 'jianshou'],
    ['黃巾力士', '群', 3, 2.0, '步', 2, 72, 1.6, 72, 1.6, 20, 0.3, 50, 1.1, 20, 'huangjinlishi'],
    ['卞喜', '魏', 2, 1.5, '步', 2, 58, 1.3, 55, 1.2, 30, 0.5, 45, 1.0, 10, 'jushou'],
    ['胡車兒', '群', 2, 1.5, '步', 2, 62, 1.4, 52, 1.1, 20, 0.3, 50, 1.1, 10, 'tuji'],
    ['裴元紹', '群', 2, 1.5, '騎', 2, 60, 1.3, 50, 1.1, 25, 0.4, 55, 1.2, 10, 'chongfeng'],
    ['孟達', '蜀', 2, 1.5, '弓', 4, 55, 1.2, 52, 1.1, 45, 0.9, 50, 1.1, 10, 'jijianfang'],
    ['董襲', '吳', 2, 1.5, '步', 2, 60, 1.3, 55, 1.2, 25, 0.4, 48, 1.0, 10, 'fenzhan'],
    ['蔣幹', '魏', 2, 1.5, '弓', 4, 20, 0.3, 45, 0.9, 62, 1.4, 50, 1.1, 5, 'huogong'],
    ['鄉勇', '群', 1, 1.0, '步', 2, 50, 1.1, 50, 1.1, 20, 0.3, 40, 0.9, 10, 'jijiu'],
    ['游騎', '群', 1, 1.0, '騎', 2, 52, 1.1, 44, 1.0, 20, 0.3, 50, 1.1, 10, 'tuji'],
    ['弓手', '群', 1, 1.0, '弓', 4, 50, 1.1, 42, 0.9, 30, 0.5, 45, 1.0, 10, 'jijianfang'],
]
# 名稱繁簡轉換不一致時的手動對照
NAME_ALIAS = {'淩統': '凌统', '朱儁': '朱儁', '祝融': '祝融夫人', '游騎': '', '弓手': '', '鄉勇': '', '黃巾力士': ''}
# 本作只有五個陣營；官方的晉陣營武將不選用
FACTIONS = {'汉': '漢', '魏': '魏', '蜀': '蜀', '吴': '吳', '群': '群'}
TROOPS = {'骑': '騎', '步': '步', '弓': '弓'}
QUALITY_STAR = {'4-SR': 5, '3-R': 4, '2-UC': 3, '1-C': 2}
SKILL_TYPE = {'主动': 'active', '被动': 'passive', '指挥': 'command', '追击': 'pursuit'}


# ---------------------------------------------------------------------------
def parse_js_array(text, var):
    """台服資料是 `var wjzl=[...]` 形式的 JS，前有 /* */ 欄位說明、後有 // 註解掉的舊資料。"""
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    text = '\n'.join(l for l in text.split('\n') if not l.lstrip().startswith('//'))
    m = re.search(r'var\s+' + var + r'\s*=\s*', text)
    body = text[m.end():]
    body = body[body.index('['):body.rindex(']') + 1]
    try:
        return json.loads(body)
    except ValueError:
        return json.loads(re.sub(r',\s*([\]}])', r'\1', body))


def fetch(key, cache):
    url, name, var = SOURCES[key]
    path = os.path.join(cache, name) if cache else None
    if path and os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            raw = f.read()
        return parse_js_array(raw, var) if var else json.loads(raw)
    ca = os.environ.get('SSL_CERT_FILE') or os.environ.get('REQUESTS_CA_BUNDLE')
    if not ca and os.path.exists('/root/.ccr/ca-bundle.crt'):
        ca = '/root/.ccr/ca-bundle.crt'
    ctx = ssl.create_default_context(cafile=ca) if ca else ssl.create_default_context()
    ref = 'https://stzb.gamedreamer.com.tw/plate.html' if var else 'https://stzb.163.com/card_list.html'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': ref})
    with urllib.request.urlopen(req, context=ctx, timeout=60) as r:
        raw = r.read().decode('utf-8')
    if path:
        os.makedirs(cache, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(raw)
    return parse_js_array(raw, var) if var else json.loads(raw)


def strip_level_range(desc):
    """台服說明寫成「傷害率190.0% ** 84.4%」（滿級 ** 一級），只保留滿級數值。"""
    return re.sub(r'\s*\*\*\s*[\d.]+%?', '', desc or '')


def tw_hero(h, t2s):
    """台服武將轉成與網易 hero_extra 相同的欄位（陣營/兵種轉簡體以共用對照表）。"""
    o = dict(h)
    o['country'] = t2s.convert(h['contory'])
    o['type'] = t2s.convert(h['type'])
    o['key'] = t2s.convert(h['name'])
    o['disp'] = h['uniqueName']
    o['icon'] = 'tw:%d' % h['id']
    o['src'] = '台服'
    return o


def tw_skill(k, t2s):
    """台服戰法：解析用簡體文字（與網易共用解析規則），顯示用台服原文。"""
    desc = strip_level_range(k.get('desc'))
    return {
        'id': k['id'], 'name': t2s.convert(k['name']), 'type': t2s.convert(k.get('type') or ''),
        'probability': k.get('probability') or '--', 'zfQuality': k.get('zfQuality') or 'B',
        'soldierType': t2s.convert(k.get('soldierType') or '弓步骑'), 'targetType': t2s.convert(k.get('targetType') or ''),
        'distance': k.get('distance'), 'desc': t2s.convert(desc).replace('(', '（').replace(')', '）'),
        '_disp_name': k['name'], '_disp_desc': desc,
    }


def make_cc():
    try:
        from opencc import OpenCC
    except ImportError:
        sys.exit('需要 opencc：pip install opencc-python-reimplemented')

    def mk(cfg):
        try:
            return OpenCC(cfg)
        except Exception:
            return OpenCC(cfg + '.json')
    return mk('s2tw'), mk('tw2s')


# ---------------------------------------------------------------------------
# 戰法描述 → 戰鬥引擎效果（js/battle.js 的 fx）
STAT = {'攻击': 'atk', '防御': 'def', '谋略': 'int', '速度': 'spd'}
DOT = ['燃烧', '灼烧', '恐慌', '妖术', '动摇', '中毒', '溃逃', '沙暴', '水攻', '叛逃', '诅咒']
CTRL = [('震慑', 'stun'), ('混乱', 'confuse'), ('暴走', 'confuse'), ('计穷', 'silence'), ('犹豫', 'silence'),
        ('无法发动主动战法', 'silence'), ('缴械', 'disarm'), ('怯战', 'disarm'), ('无法进行普通攻击', 'disarm')]
TIMES = {'一次': 1, '二次': 2, '两次': 2, '2次': 2, '三次': 3, '3次': 3, '四次': 4}


def first_variant(desc):
    """官方描述常把同一戰法的兩個版本直接接在一起（例：…持續3回合1回合準備，…持續4回合），只取第一段。"""
    d = desc.strip()
    head = d[:8]
    if len(head) >= 6:
        k = d.find(head, 8)
        if k > 0:
            return d[:k]
    return d


def group_tgt(kind, target_type):
    tt = target_type or ''
    if kind == 'e':
        if '2-3' in tt:
            return 'e23'
        return 'eAll' if '3个目标' in tt else 'e2'
    return 'aAll' if '3个目标' in tt else 'a2'


def tgt_in(clause, target_type):
    """回傳子句中最先出現的目標代號。"""
    pats = [
        ('敌军全体', 'eAll'), ('敌军群体', 'eG'), ('敌军单体', 'e1'), ('攻击目标', 'e1'), ('命中目标', 'e1'), ('伤害来源', 'e1'), ('敌军大营', 'e1'), ('敌军前锋', 'e1'),
        ('敌军兵力最', 'e1'), ('敌军目标', 'e2'), ('友军目标', 'a2'), ('敌军防御最', 'e1'), ('敌军谋略最', 'e1'), ('敌军攻击最', 'e1'), ('敌方兵力最多单体', 'e1'),
        ('我军全体', 'aAll'), ('友军全体', 'aAll'), ('我军群体', 'aG'), ('友军群体', 'aG'),
        ('损失兵力最多', 'aLow'), ('兵力最低', 'aLow'), ('我军单体', 'a1'), ('友军单体', 'a1'), ('我军大营', 'a1'), ('我军前锋', 'a1'),
        ('自身', 'self'), ('自己', 'self'),
    ]
    best = None
    for w, t in pats:
        i = clause.find(w)
        if i >= 0 and (best is None or i < best[0]):
            best = (i, t)
    if not best:
        return None
    t = best[1]
    if t == 'eG':
        return group_tgt('e', target_type)
    if t == 'aG':
        return group_tgt('a', target_type)
    return t


def default_tgt(target_type, stype):
    tt = (target_type or '').strip()
    if tt.startswith('敌军') or tt.startswith('攻击目标'):
        if '全体' in tt or '3个目标' in tt:
            return 'eAll'
        if '群体' in tt:
            return group_tgt('e', tt)
        return 'e1'
    if tt.startswith('我军') or tt.startswith('友军'):
        if '全体' in tt or '3个目标' in tt:
            return 'aAll'
        if '群体' in tt:
            return group_tgt('a', tt)
        return 'a1'
    return 'self' if stype in ('passive', 'command') else 'e1'


def num(s):
    v = round(float(s), 2)
    return int(v) if v == int(v) else round(v, 1)


# 描述是條件、疊層或借用其他戰法的機制，戰鬥引擎沒有對應效果時，手動指定近似效果（說明仍用官方原文）
def _st(st, tgt, dur=99, **kw):
    return dict({'k': 'st', 'st': st, 'tgt': tgt, 'dur': dur}, **kw)


def _stats(k, tgt, v, dur):
    return [{'k': k, 'stat': s, 'tgt': tgt, 'dur': dur, 'v': v} for s in ('atk', 'def', 'int', 'spd')]


MANUAL = {
    '连环计': [{'k': 'dmg', 't': 'int', 'rate': 1.6, 'tgt': 'e1'}, _st('confuse', 'e1', 1, p=0.5), {'k': 'dmg', 't': 'int', 'rate': 1.2, 'tgt': 'e1'}],
    '援护': [_st('taunt', 'self', 2), {'k': 'buff', 'stat': 'def', 'tgt': 'self', 'dur': 2, 'pct': 0.2}],
    '心战为上': [_st('dmgDealt', 'aAll', 99, v=0.1)],
    '奇门遁甲': [{'k': 'dmg', 't': 'int', 'rate': 1.5, 'tgt': 'e2'}],
    '黄天余音': _stats('debuff', 'e1', 26, 1) + _stats('buff', 'self', 26, 1),
    '难知如阴': [_st('dmgDealt', 'aAll', 99, v=0.12)],
    '击势': [_st('dmgDealt', 'self', 99, v=0.33), {'k': 'debuff', 'stat': 'def', 'tgt': 'eAll', 'dur': 99, 'pct': 0.2}],
    '鸟云山兵': [_st('dmgTaken', 'a2', 99, v=-0.2)],
    '甚陷不惧': [_st('dmgDealt', 'self', 99, v=0.2)],
    '动如雷震': [_st('dmgDealt', 'a2', 1, v=0.4)],
    '鏖兵卫主': [{'k': 'buff', 'stat': 'def', 'tgt': 'a2', 'dur': 99, 'v': 23}, _st('dmgTaken', 'self', 99, v=-0.15)],
    '久战熟谋': [_st('dmgDealt', 'a2', 99, v=0.15)],
    # 解析結果偏差較大者
    '鸾凤和鸣': {'rfx': [{'k': 'heal', 'rate': 0.85, 'tgt': 'a2'}]},
    '乘间击隙': {'fx': [_st('dmgDealt', 'self', 99, v=0.15)], 'rfx': [{'k': 'dmg', 't': 'phys', 'rate': 2.4, 'tgt': 'e2'}], 'rp': 0.3},
    '审时定计': {'fx': [_st('dmgTaken', 'eAll', 99, v=0.15, p=0.5)], 'rfx': [{'k': 'heal', 'rate': 0.65, 'tgt': 'a1'}], 'rp': 0.5},
    '当敌制决': [_st('dmgTaken', 'self', 99, v=-0.35), _st('counter', 'self', 99, v=0.3)],
    '疮痍累身': [_st('dmgTaken', 'self', 99, v=-0.5), _st('taunt', 'self', 2)] + [{'k': 'buff', 'stat': x, 'tgt': 'self', 'dur': 99, 'v': 20} for x in ('atk', 'def', 'int')],
    '断首何怒': [_st('dmgTaken', 'self', 99, v=-0.45), _st('dmgDealt', 'eAll', 99, v=-0.15)],
    '垒实迎击': {'fx': [_st('evade', 'self', 99, v=0.25)], 'rfx': [{'k': 'heal', 'rate': 1.0, 'tgt': 'self'}], 'rp': 0.5},
    '以诱待来': {'fx': [_st('taunt', 'self', 99, p=0.5)], 'rfx': [{'k': 'heal', 'rate': 0.75, 'tgt': 'self'}], 'rp': 0.5},
    '京观垒冢': {'rfx': [{'k': 'dmg', 't': 'phys', 'rate': 2.0, 'tgt': 'e1'}], 'rp': 0.7},
    '舍身卫主': {'fx': [_st('taunt', 'self', 3)], 'rfx': [{'k': 'dmg', 't': 'phys', 'rate': 1.2, 'tgt': 'e1'}], 'rp': 0.6},
    '盲侯奋勇': {'rfx': [{'k': 'dmg', 't': 'phys', 'rate': 0.6, 'tgt': 'e2'}], 'rp': 0.4},
    '众谋不懈': {'rfx': [{'k': 'dmg', 't': 'int', 'rate': 1.94, 'tgt': 'e1'}], 'rp': 0.4},
    '九伐中原': {'fx': [_st('dmgDealt', 'self', 99, v=0.1)], 'rfx': [{'k': 'dmg', 't': 'phys', 'rate': 0.9, 'tgt': 'e2'}, {'k': 'dmg', 't': 'int', 'rate': 0.9, 'tgt': 'e2'}], 'rp': 0.4},
    '奋疾先登': {'fx': [_st('dmgDealt', 'self', 99, v=0.2)], 'rfx': [{'k': 'dmg', 't': 'phys', 'rate': 1.9, 'tgt': 'e2'}, {'k': 'debuff', 'stat': 'spd', 'tgt': 'e2', 'dur': 99, 'v': 20}], 'rp': 0.25},
    '百战无怯': {'fx': [_st('dmgTaken', 'self', 99, v=-0.2)], 'rfx': [{'k': 'heal', 'rate': 2.0, 'tgt': 'self'}], 'rr': 3},
    '宣威再战': [{'k': 'dmg', 't': 'phys', 'rate': 1.5, 'tgt': 'e1'}, {'k': 'dmg', 't': 'phys', 'rate': 0.75, 'tgt': 'e1'}],
    '将出关西': [{'k': 'dmg', 't': 'phys', 'rate': 2.5, 'tgt': 'e1'}, {'k': 'dmg', 't': 'phys', 'rate': 1.5, 'tgt': 'e1'}, {'k': 'dmg', 't': 'phys', 'rate': 0.9, 'tgt': 'e1'}],
    '擅兵不寡': {'rfx': [{'k': 'heal', 'rate': 2.7, 'tgt': 'self'}]},
    '万军取首': [{'k': 'dmg', 't': 'phys', 'rate': 1.6, 'tgt': 'e1'}, {'k': 'dmg', 't': 'phys', 'rate': 0.8, 'tgt': 'e1'}],
}


def parse_skill(raw, cc_s2t):
    stype = SKILL_TYPE.get(raw['type'], 'active')
    text = first_variant(raw['desc'])
    text = re.sub(r'，?受[^（）]{1,12}?属性影响', '', text)  # 去掉「受謀略屬性影響」
    tt = raw.get('targetType', '')
    prep = 0
    m = re.search(r'(\d)回合准备', text)
    if m:
        prep = int(m.group(1))
    fx, rfx = [], []
    rounds = 0
    rprob = None
    cur = default_tgt(tt, stype)
    persist = stype in ('passive', 'command')

    for sent in re.split(r'[；。]', text):
        if not sent:
            continue
        dur = None
        m = re.search(r'持续(\d+)回合', sent)
        if m:
            dur = int(m.group(1))
        mfront = re.search(r'前(\d)回合', sent)
        if dur is None and mfront:
            dur = int(mfront.group(1))
        if '首回合' in sent and dur is None:
            dur = 1
        if dur is None and ('直到战斗结束' in sent or '本场战斗' in sent):
            dur = 99
        if dur is None:
            dur = 99 if persist else 1
        each_round = persist and '每回合' in sent
        if each_round and mfront:
            rounds = int(mfront.group(1))

        # 以逗號切子句，但保留括號內的逗號
        clauses, depth, buf = [], 0, ''
        for ch in sent:
            if ch in '（(':
                depth += 1
            elif ch in '）)':
                depth -= 1
            if ch == '，' and depth <= 0:
                clauses.append(buf)
                buf = ''
            else:
                buf += ch
        clauses.append(buf)

        prev = ''
        for cl in clauses:
            ctx, prev = prev + cl, cl
            t = tgt_in(cl, tt)
            if t:
                cur = t
            tgt = cur
            is_enemy = tgt[0] == 'e'
            pm = re.search(r'([\d.]+)%的?几率', cl)
            prob = round(float(pm.group(1)) / 100, 2) if pm else None
            out = rfx if each_round else fx
            if each_round and prob and rprob is None and '伤害率' in sent:
                rprob = prob
            handled = False

            # 反擊
            m = re.search(r'反击（伤害率([\d.]+)%', cl)
            if m:
                fx.append({'k': 'st', 'st': 'counter', 'v': round(float(m.group(1)) / 100, 2), 'tgt': 'self' if is_enemy else tgt, 'dur': dur})
                handled = True
            # 持續傷害（燃燒、恐慌、妖術…）
            m = re.search(r'（伤害率([\d.]+)%', cl)
            if m and not handled and any(w in ctx for w in DOT) and ('状态' in ctx or '损失' in cl or '诅咒' in ctx or '引发' in cl) and not re.search(r'(发动|造成)[^（]*?(攻击|猛攻|猛击|火攻|水攻)', cl[:m.start()]):
                st = 'burn' if ('燃烧' in ctx or '灼烧' in ctx) else 'fear'
                rec = {'k': 'st', 'st': st, 'v': round(float(m.group(1)) / 100, 2), 'tgt': tgt, 'dur': 99 if dur == 99 else max(1, dur)}
                if prob and prob < 1:
                    rec['p'] = prob
                fx.append(rec)
                handled = True
            # 直接傷害
            if not handled:
                last = 0
                for m in re.finditer(r'（伤害率([\d.]+)%', cl):
                    before, last = cl[last:m.start()], m.end()
                    if '分兵' in before[-6:]:
                        continue
                    kind = 'int' if re.search(r'策略|火攻|水攻|谋略', before) else 'phys'
                    times = 1
                    for w, n in TIMES.items():
                        if w in before:
                            times = max(times, n)
                    dt = tgt if is_enemy else default_tgt(tt, 'active') if default_tgt(tt, 'active')[0] == 'e' else 'e1'
                    for _ in range(times):
                        out.append({'k': 'dmg', 't': kind, 'rate': round(float(m.group(1)) / 100, 2), 'tgt': dt})
                    handled = True
            # 治療 / 休整
            m = re.search(r'恢复率([\d.]+)%', cl)
            if m:
                rate = round(float(m.group(1)) / 100, 2)
                ht = tgt if tgt[0] in 'as' else 'self'
                if '休整' in ctx:
                    fx.append({'k': 'st', 'st': 'regen', 'v': rate, 'tgt': ht, 'dur': dur})
                else:
                    out.append({'k': 'heal', 'rate': rate, 'tgt': ht})
                handled = True
            # 屬性增減
            for m in re.finditer(r'((?:攻击|防御|谋略|速度)(?:属性)?(?:[、和与及](?:攻击|防御|谋略|速度)(?:属性)?)*属性|全属性)(?:全部)?(提高|提升|增加|降低|下降|减少)([\d.]+)(%?)', cl):
                stats = list(STAT.values()) if m.group(1) == '全属性' else [STAT[s] for s in re.findall('攻击|防御|谋略|速度', m.group(1))]
                sign = 1 if m.group(2) in ('提高', '提升', '增加') else -1
                val = float(m.group(3))
                for s in stats:
                    rec = {'k': 'buff' if sign > 0 else 'debuff', 'stat': s, 'tgt': tgt, 'dur': dur}
                    if m.group(4):
                        rec['pct'] = round(val / 100, 3)
                    else:
                        rec['v'] = num(val)
                    fx.append(rec)
                handled = True
            # 受到傷害 / 造成傷害
            m = re.search(r'受到[^，]*?伤害(?:都)?(提高|提升|增加|降低|下降|减少)([\d.]+)%', cl)
            if m:
                sign = 1 if m.group(1) in ('提高', '提升', '增加') else -1
                rec = {'k': 'st', 'st': 'dmgTaken', 'v': round(sign * float(m.group(2)) / 100, 3), 'tgt': tgt, 'dur': dur}
                if prob and prob < 1 and '规避' not in cl:
                    rec['p'] = prob
                fx.append(rec)
                handled = True
            else:
                m = re.search(r'(?:造成|进行|发动)[^，]*?伤害(提高|提升|增加|降低|下降|减少|大幅下降|大幅度降低)([\d.]+)?%?', cl)
                if m and ('伤害率' not in cl[m.start():m.end()]):
                    sign = 1 if m.group(1) in ('提高', '提升', '增加') else -1
                    v = float(m.group(2)) / 100 if m.group(2) else 0.3
                    fx.append({'k': 'st', 'st': 'dmgDealt', 'v': round(sign * v, 3), 'tgt': tgt, 'dur': dur})
                    handled = True
            # 攻擊距離
            m = re.search(r'攻击距离\+(\d)', cl)
            if m and tgt == 'self':
                fx.append({'k': 'range', 'v': int(m.group(1))})
                handled = True
            # 狀態
            immune = '免疫' in cl
            if '洞察' in cl:
                fx.append({'k': 'st', 'st': 'insight', 'tgt': 'self' if is_enemy else tgt, 'dur': dur})
                handled = True
            if '规避' in cl.replace('无视规避', ''):
                fx.append({'k': 'st', 'st': 'evade', 'v': prob if prob else 0.5, 'tgt': 'self' if is_enemy else tgt, 'dur': dur})
                handled = True
            if re.search('优先行动|先手|先攻', cl):
                fx.append({'k': 'st', 'st': 'first', 'tgt': 'self' if is_enemy else tgt, 'dur': dur})
                handled = True
            if re.search('两次普通攻击|连击', cl):
                fx.append({'k': 'st', 'st': 'double', 'v': prob if prob else 1, 'tgt': 'self' if is_enemy else tgt, 'dur': dur})
                handled = True
            if '援护' in cl and not immune:
                fx.append({'k': 'st', 'st': 'taunt', 'tgt': 'self', 'dur': dur})
                handled = True
            elif re.search('挑衅|嘲讽', cl) and not immune and (is_enemy or '攻击自身' in cl):
                fx.append({'k': 'st', 'st': 'taunt', 'tgt': 'self', 'dur': dur})
                handled = True
            if not immune:
                seen = set()
                for w, st in CTRL:
                    i = cl.find(w)
                    if i >= 0 and st not in seen and '处于' not in cl[max(0, i - 6):i]:
                        seen.add(st)
                        ct = 'self' if ('但' in cl[:i] or '代价' in cl) else tgt
                        rec = {'k': 'st', 'st': st, 'tgt': ct, 'dur': 1 if dur == 99 and not persist else dur}
                        if prob and prob < 1:
                            rec['p'] = prob
                        fx.append(rec)
                        handled = True

    # 同一狀態對同一目標只保留第一次（例：「陷入怯戰狀態，無法進行普通攻擊」）
    seen_st, dd = set(), []
    for f in fx:
        if f['k'] == 'st':
            key = (f['st'], f['tgt'])
            if key in seen_st:
                continue
            seen_st.add(key)
        dd.append(f)
    fx = dd
    # 追擊戰法的目標就是普攻目標
    if stype == 'pursuit':
        for f in fx:
            if f.get('tgt') in ('e2', 'e23', 'eAll') and f['k'] == 'dmg' and '攻击目标' in text:
                f['tgt'] = 'e1'
    approx = False
    if raw['name'] in MANUAL:
        mv = MANUAL[raw['name']]
        if isinstance(mv, list):
            mv = {'fx': mv}
        fx, rfx = [dict(f) for f in mv.get('fx', [])], [dict(f) for f in mv.get('rfx', [])]
        rprob, rounds = mv.get('rp'), mv.get('rr', 0)
    if not fx and not rfx:
        approx = True
        if stype in ('active', 'pursuit'):
            fx.append({'k': 'dmg', 't': 'phys', 'rate': 1.2, 'tgt': default_tgt(tt, 'active') if default_tgt(tt, 'active')[0] == 'e' else 'e1'})
        else:
            fx.append({'k': 'st', 'st': 'dmgDealt', 'v': 0.1, 'tgt': 'self', 'dur': 99})

    prob = raw.get('probability', '--')
    chance = None
    ps = re.findall(r'([\d.]+)%', prob)
    if ps:
        chance = min(1.0, max(float(x) for x in ps) / 100)
    elif stype in ('active', 'pursuit'):
        chance = 0.35
    troops = None
    st = raw.get('soldierType', '弓步骑')
    if st and len(st) < 3:
        troops = [TROOPS.get(c, c) for c in st]
    rng = raw.get('distance')
    q = raw.get('zfQuality', 'B') or 'B'
    s = {
        'id': 'o' + str(raw['id']), 'name': raw.get('_disp_name') or cc_s2t.convert(raw['name']), 'type': stype, 'q': q,
    }
    if chance is not None and stype in ('active', 'pursuit'):
        s['chance'] = round(chance, 2)
    if stype == 'active':
        s['prep'] = prep
    if isinstance(rng, int) and rng > 0:
        s['range'] = rng
    s['fx'] = fx
    if rfx:
        s['rfx'] = rfx
        if rounds:
            s['rr'] = rounds
        if rprob and rprob < 1:
            s['rp'] = rprob
    if troops:
        s['troops'] = troops
    s['desc'] = first_variant(raw['_disp_desc']) if raw.get('_disp_desc') else cc_s2t.convert(first_variant(raw['desc']))
    return s, approx


# ---------------------------------------------------------------------------
def pick_official(name_s, faction, troop, by_name):
    cands = [h for h in by_name.get(name_s, []) if h['country'] in FACTIONS and h['quality'] in QUALITY_STAR]
    if not cands:
        return None

    def score(h):
        return (
            FACTIONS[h['country']] == faction,
            QUALITY_STAR[h['quality']],
            TROOPS.get(h['type']) == troop,
            not h.get('base_hero_id'),
            -h['id'],
        )
    return max(cands, key=score)


def js(v):
    """輸出單引號風格的 JS 字面量（與專案其他檔案一致）。"""
    if isinstance(v, str):
        return "'" + v.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n') + "'"
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (list, tuple)):
        return '[' + ', '.join(js(x) for x in v) + ']'
    if isinstance(v, dict):
        return '{ ' + ', '.join(k + ': ' + js(x) for k, x in v.items()) + ' }' if v else '{}'
    return json.dumps(v)


def fx_js(fx):
    return '[' + ', '.join('{ ' + ', '.join(k + ': ' + js(v) for k, v in f.items()) + ' }' for f in fx) + ']'


def skill_js(s):
    parts = []
    for k, v in s.items():
        parts.append(k + ': ' + (fx_js(v) if k in ('fx', 'rfx') else js(v)))
    return '    { ' + ', '.join(parts) + ' },'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', help='官方 JSON 快取目錄')
    ap.add_argument('--report', action='store_true', help='列出所有解析結果')
    a = ap.parse_args()
    cc_s2t, cc_t2s = make_cc()
    cn_heroes = fetch('cn_hero', a.cache)
    for h in cn_heroes:
        h['key'], h['disp'], h['icon'], h['src'] = h['name'], cc_s2t.convert(h['uniqueName']), 'cn:%d' % int(h['iconId']), '網易'
    tw_heroes = [tw_hero(h, cc_t2s) for h in fetch('tw_hero', a.cache)]
    cn_skills = fetch('cn_skill', a.cache)
    tw_skills = [tw_skill(k, cc_t2s) for k in fetch('tw_skill', a.cache)]
    # 以台服為準：同編號戰法、同名武將先用台服，台服沒有才用網易
    skill_by_id, skill_by_name = {}, {}
    for s in tw_skills + cn_skills:
        skill_by_id.setdefault(s['id'], s)
        skill_by_name.setdefault(s['name'], s)
    tw_by_name, cn_by_name = {}, {}
    for h in tw_heroes:
        tw_by_name.setdefault(h['key'], []).append(h)
    for h in cn_heroes:
        cn_by_name.setdefault(h['key'], []).append(h)

    rows, used, alias, report = [], {}, {}, []
    for r in BASE:
        name, faction, star, cost, troop, rng, atk, atkG, df, defG, it, intG, spd, spdG, siege, skill = r
        name_s = NAME_ALIAS.get(name)
        if name_s is None:
            name_s = cc_t2s.convert(name)
        o = (pick_official(name_s, faction, troop, tw_by_name) or pick_official(name_s, faction, troop, cn_by_name)) if name_s else None
        if not o:
            # 非官方武將：沿用本作數值，攻城改為「基礎 + 成長」
            rows.append([name, faction, star, cost, troop, rng, atk, atkG, df, defG, it, intG, spd, spdG,
                         round(siege / 4, 1), round(siege / 80, 2), skill, skill, 0])
            report.append('  %-6s（非官方，沿用）' % name)
            continue
        sid = o.get('methodId')
        iid = o.get('methodId1') or sid
        sid, iid = (int(x) if x else None for x in (sid, iid))
        for x in (sid, iid):
            if x in skill_by_id and x not in used:
                used[x] = parse_skill(skill_by_id[x], cc_s2t)
        self_id = 'o%d' % sid if sid in used else skill
        inh_id = 'o%d' % iid if iid in used else self_id
        if self_id != skill:
            alias[skill] = self_id
        rows.append([
            name, FACTIONS[o['country']], QUALITY_STAR[o['quality']], float(o['cost']), TROOPS[o['type']], int(o['distance']),
            num(o['attack']), num(o['attGrow']), num(o['def']), num(o['defGrow']), num(o['ruse']), num(o['ruseGrow']),
            num(o['speed']), num(o['speedGrow']), num(o['siege']), num(o['siegeGrow']), self_id, inh_id, o['icon'],
        ])
        report.append('  %-6s ← [%s] %s（%s）自帶【%s】傳承【%s】' % (name, o['src'], o['disp'], o['quality'],
                                                          used[sid][0]['name'] if sid in used else '-', used[iid][0]['name'] if iid in used else '-'))

    # 通用戰法：官方有同名戰法者改用官方數值（保留 id，讓 BASIC_SKILLS 與存檔可用）
    GENERIC = {'tuji': '突击', 'chongfeng': '冲锋', 'huogong': '火攻', 'luanji': '乱击', 'jijiu': '急救', 'jianshou': '坚守',
               'yuanhu': '援护', 'fenzhan': '奋战', 'guwu': '鼓舞', 'mouzhi': '运筹帷幄', 'shensu': '神速', 'lianji': '连击',
               'zanbiqifeng': '暂避其锋', 'tiaoxin': '挑衅', 'zhenshe': '震慑', 'jiqiong': '计穷', 'jiaoxie': '缴械',
               'kongluan': '恐慌', 'xiuzheng': '休整', 'dongcha': '洞察', 'xiangong': '先攻', 'pozhencuijian': '破阵摧坚',
               'guagu': '刮骨疗毒', 'jijianfang': '箭阵', 'jushou': '拒守', 'jiqu': '疾驱', 'naojiu': '搦战',
               'ansha': '谋定后动', 'poqianjun': '横扫千军', 'shisanhuan': '雷霆万钧', 'shoucheng': '坐守孤城'}
    generic = []
    for gid, nm in GENERIC.items():
        raw = skill_by_name.get(nm)
        if raw:
            s, ap_ = parse_skill(raw, cc_s2t)
            s['id'] = gid
            generic.append((s, ap_))
    alias = {k: v for k, v in alias.items() if k not in GENERIC}

    # ---- heroes.js
    out = ["// 武將資料庫：由 tools/sync_official.py 依《率土之濱》官方武將庫產生（以台服 wjzl.js 為準，台服沒有的武將用網易 hero_extra.json），請勿手動修改數值",
           "// 官方有收錄的武將使用官方陣營、星級、統御、兵種、攻擊距離、四維與成長、攻城、自帶/傳承戰法；卡圖只記錄來源與編號",
           "// 欄位：名稱, 陣營, 星級, 統御, 兵種, 攻擊距離, 攻擊, 攻擊成長, 防禦, 防禦成長, 謀略, 謀略成長, 速度, 速度成長, 攻城, 攻城成長, 自帶戰法, 傳承戰法, 官方卡圖（tw:台服編號 / cn:網易編號 / 0＝非官方武將）",
           "'use strict';", "", "var HEROES = (function () {", "  const RAW = ["]
    last = None
    for row in rows:
        if row[2] != last:
            out.append('    // ===== ' + '一二三四五'[row[2] - 1] + '星 =====')
            last = row[2]
        out.append('    [' + ', '.join("'%s'" % v if isinstance(v, str) else repr(v) for v in row) + '],')
    out += [
        "  ];",
        "  const list = RAW.map(function (r, i) {",
        "    return {",
        "      id: i, name: r[0], faction: r[1], star: r[2], cost: r[3], troop: r[4], range: r[5],",
        "      atk: r[6], atkG: r[7], def: r[8], defG: r[9], int: r[10], intG: r[11], spd: r[12], spdG: r[13],",
        "      siege: r[14], siegeG: r[15], skill: r[16], inherit: r[17] || r[16], icon: r[18] || 0,",
        "    };",
        "  });",
        "  // 主屬性（AI 加點/陣容判斷用）：以 30 級屬性判斷",
        "  for (const h of list) h.role = h.int + h.intG * 29 > h.atk + h.atkG * 29 + 10 ? 'int' : 'atk';",
        "  return list;",
        "})();",
        "",
        "var HERO_BY_NAME = {};",
        "for (const h of HEROES) HERO_BY_NAME[h.name] = h;",
        "",
        "var FACTION_COLOR = { '漢': '#b89530', '魏': '#3d62a8', '蜀': '#3f8a4c', '吳': '#b0412f', '群': '#6d6177' };",
        "var TROOP_COUNTER = { '騎': '步', '步': '弓', '弓': '騎' }; // 騎克步、步克弓、弓克騎",
        "",
    ]
    heroes_js = '\n'.join(out)
    with open(os.path.join(ROOT, 'js/data/heroes.js'), 'w', encoding='utf-8') as f:
        f.write(heroes_js)

    # ---- skills.js 官方區塊
    blk = ['  // <official> 由 tools/sync_official.py 依官方戰法庫產生（以台服 jzzl.js 為準，台服沒有的用網易 skill_extra.json），請勿手動修改',
           '  const OFFICIAL = [', '    // ---- 武將自帶 / 傳承戰法']
    approx_list = []
    for sid in sorted(used):
        s, ap_ = used[sid]
        blk.append(skill_js(s))
        if ap_:
            approx_list.append(s['name'])
    blk.append('    // ---- 通用戰法（官方同名戰法）')
    for s, ap_ in generic:
        blk.append(skill_js(s))
        if ap_:
            approx_list.append(s['name'])
    blk.append('  ];')
    blk.append('  // 舊版自帶戰法 → 官方戰法（讀取舊存檔用）')
    blk.append('  const ALIAS = ' + js(alias) + ';')
    blk.append('  // </official>')
    p = os.path.join(ROOT, 'js/data/skills.js')
    with open(p, encoding='utf-8') as f:
        src = f.read()
    new_src, n = re.subn(r'  // <official>.*?// </official>', lambda _: '\n'.join(blk), src, flags=re.S)
    if n != 1:
        sys.exit('skills.js 找不到 // <official> … // </official> 區塊')
    with open(p, 'w', encoding='utf-8') as f:
        f.write(new_src)

    tw_ids = {k['id'] for k in tw_skills}
    print('武將 %d 名（台服 %d、網易 %d、沿用 %d），官方戰法 %d 個（台服 %d、網易 %d）、通用戰法覆寫 %d 個' % (
        len(rows), sum(1 for r in rows if str(r[18]).startswith('tw:')), sum(1 for r in rows if str(r[18]).startswith('cn:')),
        sum(1 for r in rows if not r[18]), len(used), sum(1 for x in used if x in tw_ids), sum(1 for x in used if x not in tw_ids), len(generic)))
    if approx_list:
        print('描述無法解析、以通用效果近似的戰法：' + '、'.join(approx_list))
    if a.report:
        print('\n'.join(report))
        for sid in sorted(used):
            s = used[sid][0]
            print(s['name'], s['type'], s.get('chance'), s.get('prep'), json.dumps(s['fx'], ensure_ascii=False), json.dumps(s.get('rfx', []), ensure_ascii=False))
            print('    ', s['desc'])


if __name__ == '__main__':
    main()
