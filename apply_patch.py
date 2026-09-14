
from pathlib import Path
import sys

src = Path(sys.argv[1] if len(sys.argv) > 1 else "app.js")
s = src.read_text(encoding="utf-8")

replacements = [
    ('const MODEL_VERSION = "15.13.2";',
     'const MODEL_VERSION = "15.13.3";'),
    ('if(!styles.length) return {label:"判定不能",escapers:0,front:0,known:0,total:horses.length};',
     'if(!styles.length) return {label:"判定材料不足",escapers:0,front:0,known:0,total:horses.length};'),
    ('    const learning=getLearning();\n    const coeff={',
     '    const learning=options.learning || getLearning();\n    const coeff={'),
    ('  const learning=getLearning();\n  const coverageInfo=coverage(rows);',
     '  const learning=options.learning || getLearning();\n  const coverageInfo=coverage(rows);'),
    ('  const model=buildModel(horses,{useMarket:false});',
     '  const backtestLearning=defaultLearning();\n  const model=buildModel(horses,{useMarket:false,learning:backtestLearning});'),
    ('    predictionSource:"pre_race_only"\n',
     '    predictionSource:"pre_race_only",\n    learningSource:"baseline_independent",\n    learningLeakageGuard:true\n')
]

for old, new in replacements:
    if old not in s:
        raise SystemExit("PATCH FAILED: target not found: " + old[:100])
    s = s.replace(old, new, 1)

src.write_text(s, encoding="utf-8")
print("patched:", src)
