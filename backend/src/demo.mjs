import { DEFAULT_CODE, EXAMPLES } from '../../shared/contracts.mjs';
export const DEMO_USERS = [
  { id: 1, username: '林老师', role: 'teacher', class_code: null, tokens: 0 },
  { id: 2, username: '小林同学', role: 'student', class_code: 'DEMO26', tokens: 0 },
  { id: 3, username: '小陈同学', role: 'student', class_code: 'DEMO26', tokens: 0 }
];
export async function seedDemo(service) {
  await service.repo.insert('classes', { id: 1, name: 'C++ 启航班 · 演示', class_code: 'DEMO26', teacher_user_id: 1 });
  for (const user of DEMO_USERS) await service.repo.insert('users', user);
  const group = await service.createGroup(DEMO_USERS[0], { name: '第一课 · 输入与输出' });
  await service.createProject(DEMO_USERS[0], { name: '两数之和', exampleId: 'sum', parentId: group.id });
  await service.createProject(DEMO_USERS[0], { name: '我的第一个 C++ 程序', exampleId: 'hello' });
  await service.createProject(DEMO_USERS[1], { name: '两数之和 · 课堂练习', exampleId: 'sum' });
  await service.createProject(DEMO_USERS[2], { name: '我的程序', exampleId: 'hello' });
}
