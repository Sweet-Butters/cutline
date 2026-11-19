#!/usr/bin/env node
const path=require('node:path');
const {readTimeline}=require('../out/core');
const {readReferences,referenceMetrics}=require('../out/reference');
(async()=>{
 const args=process.argv.slice(2),root=args[0]==='--project'?path.resolve(args[1]):process.cwd();
 const timeline=await readTimeline(root),references=await readReferences(root);
 if(!references.length){console.log('No reference/*.timeline.json files');return;}
 for(const reference of references)console.log(JSON.stringify({reference:reference.name,...referenceMetrics(timeline,reference.timeline)}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
