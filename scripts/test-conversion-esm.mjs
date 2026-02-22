import { Converter } from 'opencc-js';

const converter = Converter({ from: 'hk', to: 'cn' });
const text = '鬥破蒼穹';
const converted = converter(text);

console.log(`Original: ${text}`);
console.log(`Converted: ${converted}`);

if (converted === '斗破苍穹') {
  console.log('SUCCESS');
} else {
  console.log('FAILURE');
}
