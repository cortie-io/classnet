import { Router } from "express";
import { pool } from "../../infrastructure/db/pool.js";

// Mounted behind active-account administrator authentication and period selection.
export const adminChatHistory=Router();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function pagination(query:Record<string,unknown>) {
  const limit=Number(query.limit??20),offset=Number(query.offset??0);
  if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0)return null;
  return {limit,offset};
}
adminChatHistory.get('/admin/users/:id/chats',async(req,res)=>{
  const userId=Number(req.params.id),page=pagination(req.query);
  if(!Number.isSafeInteger(userId)||userId<1||!page)return res.status(400).json({error:'학생 또는 페이지 범위를 확인해 주세요.'});
  const {rows}=await pool.query(`SELECT c.id,c.title,c."createdAt" AS created_at,
    (SELECT count(*)::int FROM "Message_v2" m WHERE m."chatId"=c.id) AS message_count
    FROM "Chat" c WHERE c."userId"=$1 ORDER BY c."createdAt" DESC,c.id DESC LIMIT $2 OFFSET $3`,[userId,page.limit,page.offset]);
  const count=await pool.query('SELECT count(*)::int AS total FROM "Chat" WHERE "userId"=$1',[userId]);
  res.json({items:rows,total:count.rows[0].total,hasMore:page.offset+rows.length<count.rows[0].total});
});
adminChatHistory.get('/admin/chats/:id/messages',async(req,res)=>{
  const page=pagination(req.query);
  if(!uuid.test(req.params.id)||!page)return res.status(400).json({error:'대화 또는 페이지 범위를 확인해 주세요.'});
  const chat=await pool.query('SELECT id,title,"userId" AS user_id FROM "Chat" WHERE id=$1',[req.params.id]);
  if(!chat.rows[0])return res.status(404).json({error:'해당 차수에 대화가 없습니다.'});
  const {rows}=await pool.query(`SELECT id,role,parts,attachments,"createdAt" AS created_at FROM "Message_v2"
    WHERE "chatId"=$1 ORDER BY "createdAt",id LIMIT $2 OFFSET $3`,[req.params.id,page.limit,page.offset]);
  const count=await pool.query('SELECT count(*)::int AS total FROM "Message_v2" WHERE "chatId"=$1',[req.params.id]);
  res.json({chat:chat.rows[0],items:rows,total:count.rows[0].total,hasMore:page.offset+rows.length<count.rows[0].total});
});
