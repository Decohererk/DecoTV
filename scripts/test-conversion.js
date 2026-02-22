const { Converter } = require('opencc-js');

const hk2cn = Converter({ from: 'hk', to: 'cn' });
const tw2cn = Converter({ from: 'tw', to: 'cn' });
const t2cn = Converter({ from: 't', to: 'cn' });

const testCases = [
  '鬥破蒼穹',
  '斗破蒼穹',
  '權力遊戲',
  '後宮甄嬛傳',
  '憂鬱症',
  '發財',
  '頭髮',
];

console.log('Testing opencc-js conversion:');
console.log('--------------------------------------------------');
console.log('Original\t| HK->CN\t| TW->CN\t| T->CN');
console.log('--------------------------------------------------');

testCases.forEach((text) => {
  const hk = hk2cn(text);
  const tw = tw2cn(text);
  const t = t2cn(text);
  console.log(`${text}\t| ${hk}\t| ${tw}\t| ${t}`);
});
