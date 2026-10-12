#!/usr/bin/env node
const {execFileSync}=require('node:child_process');
for(const script of ['rehearse-funded-retention.cjs','rehearse-phase-transition.cjs'])execFileSync(process.execPath,[require('node:path').join(__dirname,script)],{stdio:'inherit'});
