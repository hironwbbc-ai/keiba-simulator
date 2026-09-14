const fs=require("fs");
const s=fs.readFileSync("app.js","utf8");
const checks=[
["version",s.includes('MODEL_VERSION = "15.13.3"')],
["baseline",s.includes("const backtestLearning=defaultLearning();")],
["learning override",s.includes("options.learning || getLearning()")],
["pace",s.includes('label:"判定材料不足"')],
["market excluded",s.includes("buildModel(horses,{useMarket:false,learning:backtestLearning})")],
["leakage guard",s.includes("learningLeakageGuard:true")]
];
let ok=true;
for(const [n,p] of checks){console.log((p?"OK ":"NG ")+n);ok=ok&&p}
process.exit(ok?0:1);
