package com.nova.jeansmixing

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/** Final read-only table: size rows + total row. No edits, no file saving. */
class LockedActivity : AppCompatActivity() {

    private lateinit var project: Project
    private lateinit var rows: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_locked)

        val fileName = intent.getStringExtra("projectFile")
        if (fileName == null) {
            finish()
            return
        }
        val loaded = ProjectStore.load(this, fileName)
        if (loaded == null) {
            finish()
            return
        }
        project = loaded
        rows = findViewById(R.id.lockedRows)

        findViewById<Button>(R.id.startPlacing).setOnClickListener {
            startActivity(
                Intent(this, PlacingActivity::class.java)
                    .putExtra("projectFile", project.fileName)
            )
        }

        findViewById<Button>(R.id.backToProjects).setOnClickListener {
            val intent = Intent(this, MainActivity::class.java)
            intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
            startActivity(intent)
        }
    }

    override fun onResume() {
        super.onResume()
        // Quantities can change via Part 2 shortfall cascades — always re-render.
        val reloaded = ProjectStore.load(this, project.fileName)
        if (reloaded == null) {
            finish()
            return
        }
        project = reloaded
        render()
    }

    private fun render() {
        findViewById<TextView>(R.id.lockedTitle).text = project.name

        rows.removeAllViews()
        for ((pos, entry) in project.entries.withIndex()) {
            val row = layoutInflater.inflate(R.layout.row_locked, rows, false)
            if (pos % 2 == 1) row.setBackgroundColor(getColor(R.color.row_yellow))
            row.findViewById<TextView>(R.id.lockSize).text = entry.displaySize()
            row.findViewById<TextView>(R.id.lockQty).text = entry.quantity.toString()
            rows.addView(row)
        }

        val total = project.entries.sumOf { it.quantity }
        findViewById<TextView>(R.id.lockedTotal).text =
            "$total pairs → ${total / 25} boxes"
    }
}
