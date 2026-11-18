import {PrismaClient} from '@prisma/client';
import bcrypt from 'bcryptjs';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const db=new PrismaClient();
const creators=[
 {username:'maya',name:'Maya Chen',bio:'Finding beauty in the in-between. Sketchbook pages, studio experiments, and a closer look at my creative process. ✨',category:'Art & design',price:1200,location:'Portland, OR',colors:['#d9c7f4','#8464af','#f9d8c4'],title:'A little more behind the scenes',body:'A slow morning in the studio, and a new series taking shape. Sharing a few fragments from my latest exploration of color, texture, and the everyday. What have you been creating lately?'},
 {username:'theo',name:'Theo Rivers',bio:'Chasing light, taking the scenic route. Come along for photo diaries and the stories behind the frame.',category:'Photography',price:800,location:'Vancouver, BC',colors:['#c5d8ce','#4f7773','#e9d8b9'],title:'Somewhere between here and everywhere',body:'The best part of this walk wasn’t the destination. It was stopping long enough to notice the light. A few frames from this week’s photo diary.'},
 {username:'luna',name:'Luna West',bio:'Songs from my bedroom, notes from my notebook. New demos, honest conversations, and our little listening room.',category:'Music',price:0,location:'Austin, TX',colors:['#ecd4bc','#c88972','#f5e8d4'],title:'A new chapter, a softer sound',body:'I’ve been working on something a little different. Here’s the story behind the next song — written on a rainy afternoon with absolutely no plan.'},
 {username:'kai',name:'Kai Morgan',bio:'Small rituals for a good life. Movement, nourishing food, and a little room to breathe.',category:'Wellness',price:600,location:'Brighton, UK',colors:['#dfdfa9','#86975b','#f7e8ca'],title:'Make a little space for yourself',body:'Your reminder that a quiet start counts, too. This week we’re building a five-minute ritual you can actually keep. Save it for your next slow morning.'}
];
async function main(){
 if(process.env.NODE_ENV==='production')throw new Error('Fictional seed accounts are for local development only.');
 const passwordHash=await bcrypt.hash('FollowersOnly!2026',12);
 for(const u of [{username:'admin',name:'Studio Admin',email:'admin@followersonly.test',role:'ADMIN' as const},{username:'alex',name:'Alex Harper',email:'alex@followersonly.test',role:'SUBSCRIBER' as const}]) await db.user.upsert({where:{username:u.username},update:{},create:{id:`user-${u.username}`,...u,passwordHash,emailVerifiedAt:new Date(),ageConfirmedAt:new Date(),settings:{create:{}},subscriber:{create:{}}}});
 await mkdir(path.join(process.cwd(),'.local','media'),{recursive:true,mode:0o700});
 for(let index=0;index<creators.length;index++){
  const c=creators[index];const user=await db.user.upsert({where:{username:c.username},update:{},create:{id:`user-${c.username}`,email:`${c.username}@followersonly.test`,username:c.username,name:c.name,passwordHash,role:'CREATOR',emailVerifiedAt:new Date(),ageConfirmedAt:new Date(),settings:{create:{}},creator:{create:{bio:c.bio,category:c.category,monthlyPriceCents:c.price,location:c.location,consentAcceptedAt:new Date(),verification:'APPROVED',verificationNote:'Fictional development seed. Not an identity verification.'}}}});
  for(let p=0;p<3;p++){
   const postId=`post-${c.username}-${p}`;if(await db.post.findUnique({where:{id:postId}}))continue;
   const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="850" viewBox="0 0 1200 850"><defs><linearGradient id="b" x2="1" y2="1"><stop stop-color="${c.colors[0]}"/><stop offset="1" stop-color="${c.colors[2]}"/></linearGradient><filter id="noise"><feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".08"/></feComponentTransfer></filter></defs><rect width="1200" height="850" fill="url(#b)"/><path d="M${100+index*80} 850V430a350 350 0 0 1 700 0v420" fill="${c.colors[1]}" opacity=".7"/><circle cx="${850-index*80}" cy="210" r="130" fill="${c.colors[2]}"/><path d="M0 740Q300 400 620 690T1200 570V850H0Z" fill="${c.colors[0]}"/><path d="M0 800Q450 570 900 790T1200 700" fill="none" stroke="${c.colors[2]}" stroke-width="35"/><rect width="1200" height="850" filter="url(#noise)" opacity=".6"/><text x="60" y="70" font-family="sans-serif" font-size="18" letter-spacing="5" fill="${c.colors[1]}">FOLLOWERSONLY • STUDIO ${index+1}</text></svg>`;
   const buffer=await sharp(Buffer.from(svg)).png().toBuffer();const key=`seed-${c.username}-${p}.png`;await writeFile(path.join(process.cwd(),'.local','media',key),buffer,{mode:0o600});
   const media=await db.media.upsert({where:{key},update:{},create:{id:`media-${c.username}-${p}`,ownerId:user.id,key,mime:'image/png',size:buffer.length,purpose:'post'}});
   await db.post.create({data:{id:postId,authorId:user.id,body:p===1?`Exclusive studio notes: ${c.body} This full journal is shared with my subscribers. Thank you for making this work possible.`:c.body,preview:p===1?'A closer look, just for our circle. Subscribe to read the full studio journal.':c.title,visibility:p===1?'SUBSCRIBERS':'PUBLIC',consentConfirmed:true,createdAt:new Date(Date.now()-(index*3+p+1)*3600000),media:{create:{mediaId:media.id}}}});
  }
 }
 await db.notification.upsert({where:{id:'notification-welcome'},update:{},create:{id:'notification-welcome',userId:'user-alex',type:'welcome',text:'Welcome to your little corner of the internet. Find a creator you love.',href:'/explore'}});
 const c=await db.conversation.upsert({where:{pairKey:'user-alex:user-maya'},update:{},create:{id:'conversation-welcome',pairKey:'user-alex:user-maya',participants:{create:[{userId:'user-alex'},{userId:'user-maya'}]}}});
 await db.message.upsert({where:{id:'message-welcome'},update:{},create:{id:'message-welcome',conversationId:c.id,senderId:'user-maya',body:'Hey Alex! Welcome to my studio. I’m glad you’re here. What kind of creative work do you enjoy?'}});
 console.log('Seeded fictional FollowersOnly accounts and original artwork. Password is documented in README for local development.');
}
main().finally(()=>db.$disconnect());
