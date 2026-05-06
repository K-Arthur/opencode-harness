
const mentionPattern = /(@(file|folder|url|problems|terminal):\S+)/g;
const text = "Checking @file:/home/user/test.json and @folder:./src";
const parts = text.split(mentionPattern);
console.log(JSON.stringify(parts, null, 2));

for (let i = 0; i < parts.length; i++) {
  if (i % 3 === 0) {
    console.log(`Text: "${parts[i]}"`);
  } else if (i % 3 === 1) {
    console.log(`Match: "${parts[i]}", Type: "${parts[i+1]}"`);
    i++;
  }
}
