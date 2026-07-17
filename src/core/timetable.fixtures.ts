export const CELL_FILLED = `
<div class="jugyo-info jugyo-normal ">
  <div class="fontB">基礎電気数学及び演習 （１組）</div>
  <div class="">王　宇凱</div>
  <div class=""><span>野：445教室</span></div>
  <div class="">9973337</div>
  <div class="taniSu">2.0単位</div>
  <div class="sign signClass">複数回</div>
  <div><div class="noTextIconLine alignRight"><button class="ui-button"><span class="ui-button-text ui-c">ui-button</span></button></div></div>
</div>`

export const CELL_REMOTE = `
<div class="jugyo-info jugyo-normal ">
  <div class="fontB">データサイエンス・ＡＩ概論 （前期）</div>
  <div class="">瀬尾　隆</div>
  <div class=""><span>遠隔（オンライン）</span></div>
  <div class="">9960219</div>
  <div class="taniSu">2.0単位</div>
  <div><div class="noTextIconLine alignRight"><button class="ui-button"><span class="ui-button-text ui-c">ui-button</span></button></div></div>
</div>`

/** 科目IDに英字を含むコース（例: 機械航空宇宙力学1 = 9975A06）。 */
export const CELL_ALNUM_CODE = `
<div class="jugyo-info jugyo-normal ">
  <div class="fontB">機械航空宇宙力学1</div>
  <div class="">山本　誠</div>
  <div class=""><span>野：K404教室</span></div>
  <div class="">9975A06</div>
  <div class="taniSu">2.0単位</div>
  <div><div class="noTextIconLine alignRight"><button class="ui-button"><span class="ui-button-text ui-c">ui-button</span></button></div></div>
</div>`

export const CELL_EMPTY = `<div class="jugyo-info jugyo-normal noClass"></div>`

/**
 * クォーター科目の積みセル（実データ由来）。火1限に 有機化学・基礎(9983343) と
 * 微生物学(9983365) が各1.0単位で同居する。CLASS実HTMLは jugyo-info を単純に2つ並べるだけで、
 * どちらが1Q/2Qかを示す属性・クラス・バッジは一切付かない。
 */
export const CELL_STACKED_QUARTER = `<td class="colYobi"><div class="jugyo-info jugyo-normal "><div class="fontB">有機化学・基礎 （旧：有機化学２）</div><div class="">吉田　優</div><div class=""><span>葛：E304教室</span></div><div class="">9983343</div><div class="taniSu">1.0単位</div><div><div class="noTextIconLine alignRight"><button class="ui-button"><span class="ui-button-text ui-c">ui-button</span></button></div></div></div><div class="jugyo-info jugyo-normal "><div class="fontB">微生物学 （旧：微生物学）</div><div class="">清水　公徳</div><div class=""><span>葛：E101教室</span></div><div class="">9983365</div><div class="taniSu">1.0単位</div><div><div class="noTextIconLine alignRight"><button class="ui-button"><span class="ui-button-text ui-c">ui-button</span></button></div></div></div></td>`

/** 火1限に上記の積みセルを持つ最小テーブル（実CLASS構造）。 */
export const TABLE_STACKED_QUARTER = `
<table class="table table-bordered classTable">
  <tr>
    <th class="ui-widget-header headerJigen"></th>
    <th class="ui-widget-header headerYobi">月曜日</th>
    <th class="ui-widget-header headerYobi">火曜日</th>
    <th class="ui-widget-header headerYobi">水曜日</th>
    <th class="ui-widget-header headerYobi">木曜日</th>
    <th class="ui-widget-header headerYobi">金曜日</th>
    <th class="ui-widget-header headerYobi">土曜日</th>
  </tr>
  <tr>
    <td class="colJigen ui-widget-header">1</td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    ${CELL_STACKED_QUARTER}
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
  </tr>
</table>`

export const JIGEN_AREA_NODA = `野田（1限 08:50～10:20／2限 10:30～12:00／3限 13:00～14:30／4限 14:40～16:10／5限 16:20～17:50／6限 18:10～19:40／7限 19:50～21:20）`

export const TABLE_MINIMAL = `
<table class="table table-bordered classTable">
  <tr>
    <th class="ui-widget-header headerJigen"></th>
    <th class="ui-widget-header headerYobi">月曜日</th>
    <th class="ui-widget-header headerYobi">火曜日</th>
    <th class="ui-widget-header headerYobi">水曜日</th>
    <th class="ui-widget-header headerYobi">木曜日</th>
    <th class="ui-widget-header headerYobi">金曜日</th>
    <th class="ui-widget-header headerYobi">土曜日</th>
  </tr>
  <tr>
    <td class="colJigen ui-widget-header">1</td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal "><div class="fontB">基礎電気数学及び演習 （１組）</div><div class="">王　宇凱</div><div class=""><span>野：445教室</span></div><div class="">9973337</div><div class="taniSu">2.0単位</div><div class="sign signClass">複数回</div><div><div class="noTextIconLine"><button class="ui-button"><span class="ui-button-text ui-c">ui-button</span></button></div></div></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
  </tr>
  <tr>
    <td class="colJigen ui-widget-header">2</td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
  </tr>
  <tr>
    <td class="colJigen ui-widget-header"></td>
    <td class="colLunch alignCenter" colspan="6">昼休み</td>
  </tr>
  <tr>
    <td class="colJigen ui-widget-header">3</td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
  </tr>
  <tr>
    <td class="colJigen ui-widget-header">4</td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal "><div class="fontB">物理学実験Ａ</div><div class="">須田　亮</div><div class=""><span>野：444教室</span></div><div class="">9973344</div><div class="taniSu">1.0単位</div><div class="sign signClass">複数回</div><div><div class="noTextIconLine"><button class="ui-button"><span class="ui-button-text ui-c">ui-button</span></button></div></div></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
  </tr>
  <tr>
    <td class="colJigen ui-widget-header">5</td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
  </tr>
  <tr>
    <td class="colJigen ui-widget-header">6</td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
  </tr>
  <tr>
    <td class="colJigen ui-widget-header">7</td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
    <td class="colYobi"><div class="jugyo-info jugyo-normal noClass"></div></td>
  </tr>
</table>`
