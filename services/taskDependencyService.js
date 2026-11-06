const pool = require("../config/databse");

/**
 * Helper to check for cycles in dependency graph using DFS.
 * graph is Map of taskId -> Set of dependsOnTaskIds
 */
function hasCycle(graph, startNode, visited = new Set(), recStack = new Set()) {
  visited.add(startNode);
  recStack.add(startNode);

  const neighbors = graph.get(startNode) || new Set();
  for (const neighbor of neighbors) {
    if (!visited.has(neighbor)) {
      if (hasCycle(graph, neighbor, visited, recStack)) {
        return true;
      }
    } else if (recStack.has(neighbor)) {
      return true;
    }
  }

  recStack.delete(startNode);
  return false;
}

/**
 * Get predecessors and successors for a given task
 */
async function getTaskDependencies(taskId) {
  if (!taskId) return { predecessors: [], successors: [], is_blocked: false, blocking_tasks: [] };

  // Predecessors: tasks that taskId depends on
  const predQuery = `
    SELECT 
      t.id,
      t.task_name,
      t.status,
      t.task_date,
      t.due_date,
      u.name AS assigned_to_name,
      tdep.created_at AS dependency_created_at
    FROM task_dependencies tdep
    JOIN tasks t ON tdep.depends_on_task_id = t.id
    LEFT JOIN users u ON t.assigned_to = u.id
    WHERE tdep.task_id = $1
    ORDER BY t.due_date ASC
  `;

  // Successors: tasks that depend on taskId
  const succQuery = `
    SELECT 
      t.id,
      t.task_name,
      t.status,
      t.task_date,
      t.due_date,
      u.name AS assigned_to_name,
      tdep.created_at AS dependency_created_at
    FROM task_dependencies tdep
    JOIN tasks t ON tdep.task_id = t.id
    LEFT JOIN users u ON t.assigned_to = u.id
    WHERE tdep.depends_on_task_id = $1
    ORDER BY t.due_date ASC
  `;

  const [predRes, succRes] = await Promise.all([
    pool.query(predQuery, [taskId]),
    pool.query(succQuery, [taskId]),
  ]);

  const predecessors = predRes.rows || [];
  const successors = succRes.rows || [];

  const blockingTasks = predecessors.filter(
    (p) => String(p.status).trim().toLowerCase() !== "completed"
  );
  const isBlocked = blockingTasks.length > 0;

  return {
    predecessors,
    successors,
    is_blocked: isBlocked,
    blocking_tasks: blockingTasks,
  };
}

/**
 * Check if a task is blocked
 */
async function isTaskBlocked(taskId, client = null) {
  const db = client || pool;
  const res = await db.query(
    `SELECT t.id, t.task_name, t.status 
     FROM task_dependencies td
     JOIN tasks t ON td.depends_on_task_id = t.id
     WHERE td.task_id = $1 AND LOWER(TRIM(t.status)) != 'completed'`,
    [taskId]
  );

  return {
    isBlocked: res.rows.length > 0,
    blockingTasks: res.rows,
  };
}

/**
 * Set prerequisites (dependencies) for a task with cycle detection
 */
async function setTaskDependencies(taskId, dependsOnTaskIds = [], client = null) {
  if (!taskId) return;

  const validDependsOnIds = Array.isArray(dependsOnTaskIds)
    ? [...new Set(dependsOnTaskIds.map(String).filter((id) => id && id !== String(taskId)))]
    : [];

  const dbClient = client || (await pool.connect());
  const shouldManageTransaction = !client;

  try {
    if (shouldManageTransaction) {
      await dbClient.query("BEGIN");
    }

    // 1. Fetch current entire dependency graph to check for potential cycles
    const allDepsRes = await dbClient.query(
      `SELECT task_id, depends_on_task_id FROM task_dependencies WHERE task_id != $1`,
      [taskId]
    );

    const graph = new Map();
    // Add existing edges
    for (const row of allDepsRes.rows) {
      const u = String(row.task_id);
      const v = String(row.depends_on_task_id);
      if (!graph.has(u)) graph.set(u, new Set());
      graph.get(u).add(v);
    }

    // Add proposed edges: taskId depends on each depId
    if (!graph.has(String(taskId))) graph.set(String(taskId), new Set());
    for (const depId of validDependsOnIds) {
      graph.get(String(taskId)).add(depId);
    }

    // Check cycle starting from taskId
    if (hasCycle(graph, String(taskId))) {
      const error = new Error(
        "Circular dependency detected! A task cannot depend directly or indirectly on itself."
      );
      error.statusCode = 400;
      throw error;
    }

    // 2. Clear old dependencies for this task
    await dbClient.query(`DELETE FROM task_dependencies WHERE task_id = $1`, [taskId]);

    // 3. Insert new dependencies
    for (const depId of validDependsOnIds) {
      await dbClient.query(
        `INSERT INTO task_dependencies (task_id, depends_on_task_id)
         VALUES ($1, $2)
         ON CONFLICT (task_id, depends_on_task_id) DO NOTHING`,
        [taskId, depId]
      );
    }

    if (shouldManageTransaction) {
      await dbClient.query("COMMIT");
    }

    return await getTaskDependencies(taskId);
  } catch (err) {
    if (shouldManageTransaction) {
      await dbClient.query("ROLLBACK");
    }
    throw err;
  } finally {
    if (shouldManageTransaction) {
      dbClient.release();
    }
  }
}

/**
 * Calculate Critical Path for active project tasks
 */
async function getCriticalPathData(filterParams = {}) {
  // Fetch tasks
  let whereClauses = ["1=1"];
  const params = [];

  if (filterParams.assignedTo) {
    params.push(filterParams.assignedTo);
    whereClauses.push(`t.assigned_to = $${params.length}`);
  }

  const tasksQuery = `
    SELECT 
      t.id,
      t.task_name,
      t.status,
      t.task_date,
      t.due_date,
      t.start_time,
      t.end_time,
      u.name AS assigned_to_name,
      a.name AS assigned_by_name
    FROM tasks t
    LEFT JOIN users u ON t.assigned_to = u.id
    LEFT JOIN admin a ON t.assigned_by = a.id
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY t.task_date ASC, t.id ASC
  `;

  const tasksRes = await pool.query(tasksQuery, params);
  const tasks = tasksRes.rows || [];

  if (tasks.length === 0) {
    return {
      tasks: [],
      dependencies: [],
      critical_path: [],
      project_duration_days: 0,
      total_tasks: 0,
      critical_tasks_count: 0,
      blocked_tasks_count: 0,
      bottlenecks: [],
    };
  }

  const taskIds = tasks.map((t) => String(t.id));

  // Fetch dependencies between these tasks
  const depQuery = `
    SELECT 
      td.task_id,
      td.depends_on_task_id,
      t1.task_name AS task_name,
      t2.task_name AS depends_on_task_name
    FROM task_dependencies td
    JOIN tasks t1 ON td.task_id = t1.id
    JOIN tasks t2 ON td.depends_on_task_id = t2.id
    WHERE td.task_id = ANY($1::uuid[]) AND td.depends_on_task_id = ANY($1::uuid[])
  `;
  const depRes = await pool.query(depQuery, [taskIds]);
  const rawDeps = depRes.rows || [];

  // Build task map and duration
  const taskMap = new Map();
  const predecessorsMap = new Map(); // taskId -> list of depends_on_task_id
  const successorsMap = new Map(); // taskId -> list of successor taskIds
  const inDegree = new Map();

  for (const t of tasks) {
    const id = String(t.id);
    let durationDays = 1;
    if (t.task_date && t.due_date) {
      const d1 = new Date(t.task_date);
      const d2 = new Date(t.due_date);
      const diffTime = d2.getTime() - d1.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      durationDays = Math.max(1, diffDays);
    }

    taskMap.set(id, {
      ...t,
      duration: durationDays,
      early_start: 0,
      early_finish: durationDays,
      late_start: 0,
      late_finish: 0,
      slack: 0,
      is_critical: false,
      is_blocked: false,
      blocking_tasks: [],
      predecessors: [],
      successors: [],
    });

    predecessorsMap.set(id, []);
    successorsMap.set(id, []);
    inDegree.set(id, 0);
  }

  for (const dep of rawDeps) {
    const taskId = String(dep.task_id);
    const predId = String(dep.depends_on_task_id);

    if (taskMap.has(taskId) && taskMap.has(predId)) {
      predecessorsMap.get(taskId).push(predId);
      successorsMap.get(predId).push(taskId);
      inDegree.set(taskId, (inDegree.get(taskId) || 0) + 1);

      // Check blocking status
      const predTask = taskMap.get(predId);
      if (String(predTask.status).toLowerCase() !== "completed") {
        const currentTask = taskMap.get(taskId);
        currentTask.is_blocked = true;
        currentTask.blocking_tasks.push({
          id: predTask.id,
          task_name: predTask.task_name,
          status: predTask.status,
        });
      }
    }
  }

  // Populate predecessors & successors names
  for (const [id, node] of taskMap.entries()) {
    node.predecessors = (predecessorsMap.get(id) || []).map((pid) => ({
      id: pid,
      task_name: taskMap.get(pid)?.task_name || "",
      status: taskMap.get(pid)?.status || "",
    }));
    node.successors = (successorsMap.get(id) || []).map((sid) => ({
      id: sid,
      task_name: taskMap.get(sid)?.task_name || "",
      status: taskMap.get(sid)?.status || "",
    }));
  }

  // Topological sort (Kahn's Algorithm)
  const queue = [];
  const inDegreeCopy = new Map(inDegree);
  for (const [id, deg] of inDegreeCopy.entries()) {
    if (deg === 0) queue.push(id);
  }

  const topoOrder = [];
  while (queue.length > 0) {
    const u = queue.shift();
    topoOrder.push(u);

    for (const v of successorsMap.get(u) || []) {
      inDegreeCopy.set(v, inDegreeCopy.get(v) - 1);
      if (inDegreeCopy.get(v) === 0) {
        queue.push(v);
      }
    }
  }

  // If there are disconnected nodes or all nodes
  const processedNodes = new Set(topoOrder);
  for (const id of taskMap.keys()) {
    if (!processedNodes.has(id)) {
      topoOrder.push(id);
    }
  }

  // FORWARD PASS: Calculate Early Start (ES) and Early Finish (EF)
  for (const u of topoOrder) {
    const node = taskMap.get(u);
    const preds = predecessorsMap.get(u) || [];
    let maxPredEF = 0;
    for (const p of preds) {
      const predNode = taskMap.get(p);
      if (predNode && predNode.early_finish > maxPredEF) {
        maxPredEF = predNode.early_finish;
      }
    }
    node.early_start = maxPredEF;
    node.early_finish = node.early_start + node.duration;
  }

  // Project completion time is max EF across all tasks
  let projectDuration = 0;
  for (const node of taskMap.values()) {
    if (node.early_finish > projectDuration) {
      projectDuration = node.early_finish;
    }
  }

  // BACKWARD PASS: Calculate Late Finish (LF) and Late Start (LS)
  // Initialize LF for all nodes to projectDuration
  for (const node of taskMap.values()) {
    node.late_finish = projectDuration;
    node.late_start = node.late_finish - node.duration;
  }

  // Iterate in reverse topological order
  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const u = topoOrder[i];
    const node = taskMap.get(u);
    const succs = successorsMap.get(u) || [];
    if (succs.length > 0) {
      let minSuccLS = Infinity;
      for (const s of succs) {
        const succNode = taskMap.get(s);
        if (succNode && succNode.late_start < minSuccLS) {
          minSuccLS = succNode.late_start;
        }
      }
      node.late_finish = minSuccLS === Infinity ? projectDuration : minSuccLS;
      node.late_start = node.late_finish - node.duration;
    }
    node.slack = Math.max(0, node.late_start - node.early_start);
    node.is_critical = node.slack === 0;
  }

  // Mark dependencies as critical if both source and target are critical and EF(source) == ES(target)
  const enrichedDependencies = rawDeps.map((d) => {
    const sourceNode = taskMap.get(String(d.depends_on_task_id));
    const targetNode = taskMap.get(String(d.task_id));
    const isCritical =
      Boolean(sourceNode?.is_critical) &&
      Boolean(targetNode?.is_critical) &&
      sourceNode.early_finish === targetNode.early_start;
    return {
      source: String(d.depends_on_task_id),
      target: String(d.task_id),
      source_name: d.depends_on_task_name,
      target_name: d.task_name,
      is_critical: isCritical,
    };
  });

  const criticalTasks = Array.from(taskMap.values()).filter((t) => t.is_critical);
  const blockedTasks = Array.from(taskMap.values()).filter((t) => t.is_blocked);
  const bottlenecks = criticalTasks.filter((t) => String(t.status).toLowerCase() !== "completed");

  // Sort critical path sequence by early_start
  const criticalPathSequence = [...criticalTasks]
    .sort((a, b) => a.early_start - b.early_start)
    .map((t) => ({
      id: t.id,
      task_name: t.task_name,
      duration: t.duration,
      early_start: t.early_start,
      early_finish: t.early_finish,
      status: t.status,
      assigned_to_name: t.assigned_to_name,
      is_blocked: t.is_blocked,
    }));

  return {
    tasks: Array.from(taskMap.values()),
    dependencies: enrichedDependencies,
    critical_path: criticalPathSequence,
    project_duration_days: projectDuration,
    total_tasks: tasks.length,
    critical_tasks_count: criticalTasks.length,
    blocked_tasks_count: blockedTasks.length,
    bottlenecks: bottlenecks.map((t) => ({
      id: t.id,
      task_name: t.task_name,
      status: t.status,
      assigned_to_name: t.assigned_to_name,
      due_date: t.due_date,
    })),
  };
}

/**
 * Batch enrich tasks with dependency & blocking info
 */
async function enrichTasksWithDependencies(tasks) {
  if (!tasks || tasks.length === 0) return tasks;

  const taskIds = tasks.map((t) => String(t.id));

  // Get all dependencies for these tasks
  const res = await pool.query(
    `SELECT 
       td.task_id, 
       td.depends_on_task_id,
       t.task_name,
       t.status,
       t.due_date
     FROM task_dependencies td
     JOIN tasks t ON td.depends_on_task_id = t.id
     WHERE td.task_id = ANY($1::uuid[])`,
    [taskIds]
  );

  const depMap = new Map();
  for (const row of res.rows) {
    const tid = String(row.task_id);
    if (!depMap.has(tid)) depMap.set(tid, []);
    depMap.get(tid).push(row);
  }

  return tasks.map((task) => {
    const deps = depMap.get(String(task.id)) || [];
    const blocking = deps.filter(
      (d) => String(d.status).trim().toLowerCase() !== "completed"
    );
    return {
      ...task,
      predecessors_count: deps.length,
      predecessors: deps.map((d) => ({
        id: d.depends_on_task_id,
        task_name: d.task_name,
        status: d.status,
      })),
      is_blocked: blocking.length > 0,
      blocking_count: blocking.length,
      blocking_tasks: blocking.map((b) => ({
        id: b.depends_on_task_id,
        task_name: b.task_name,
        status: b.status,
      })),
    };
  });
}

module.exports = {
  getTaskDependencies,
  setTaskDependencies,
  isTaskBlocked,
  getCriticalPathData,
  enrichTasksWithDependencies,
};
