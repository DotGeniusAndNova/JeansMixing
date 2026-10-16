package com.nova.jeansmixing

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/** Launch screen: create a new project or open a previous one. */
class MainActivity : AppCompatActivity() {

    private lateinit var projectList: LinearLayout
    private lateinit var emptyView: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        projectList = findViewById(R.id.projectList)
        emptyView = findViewById(R.id.emptyView)

        findViewById<Button>(R.id.newProjectButton).setOnClickListener {
            val project = ProjectStore.create(this)
            openProject(project)
        }
    }

    override fun onResume() {
        super.onResume()
        renderList()
    }

    private fun renderList() {
        projectList.removeAllViews()
        val projects = ProjectStore.list(this)
        emptyView.visibility = if (projects.isEmpty()) View.VISIBLE else View.GONE

        for (p in projects) {
            val row = layoutInflater.inflate(R.layout.row_project, projectList, false)
            row.findViewById<TextView>(R.id.projectName).text = p.name
            val total = p.entries.sumOf { it.quantity }
            val placing = DealLogic.totalPlaced(p)
            val subtitle = "${p.entries.size} sizes • $total pairs" +
                    if (p.locked) " • locked" else "" +
                    if (placing > 0) " • placing $placing/$total" else ""
            row.findViewById<TextView>(R.id.projectSubtitle).text = subtitle

            row.setOnClickListener { openProject(p) }
            row.setOnLongClickListener {
                AlertDialog.Builder(this)
                    .setTitle("Delete project?")
                    .setMessage("Delete \"${p.name}\"? This can't be undone.")
                    .setPositiveButton("Delete") { _, _ ->
                        ProjectStore.delete(this, p)
                        renderList()
                    }
                    .setNegativeButton("Cancel", null)
                    .show()
                true
            }
            projectList.addView(row)
        }
    }

    private fun openProject(p: Project) {
        val cls = if (p.locked) LockedActivity::class.java else EntryActivity::class.java
        startActivity(Intent(this, cls).putExtra("projectFile", p.fileName))
    }
}
