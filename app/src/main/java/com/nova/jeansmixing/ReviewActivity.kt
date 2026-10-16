package com.nova.jeansmixing

import android.content.Intent
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/** Spreadsheet-style review: editable quantities, delete with confirm, then Confirm. */
class ReviewActivity : AppCompatActivity() {

    private lateinit var project: Project
    private lateinit var rows: LinearLayout
    private lateinit var totalView: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_review)

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

        rows = findViewById(R.id.reviewRows)
        totalView = findViewById(R.id.reviewTotal)
        findViewById<TextView>(R.id.reviewTitle).text =
            "${getString(R.string.review_title)} — ${project.name}"
        findViewById<Button>(R.id.reviewBack).setOnClickListener { finish() }
        findViewById<Button>(R.id.confirmButton).setOnClickListener { onConfirm() }
    }

    override fun onResume() {
        super.onResume()
        val reloaded = ProjectStore.load(this, project.fileName)
        if (reloaded == null) {
            finish()
            return
        }
        project = reloaded
        render()
    }

    private fun render() {
        rows.removeAllViews()
        for ((pos, entry) in project.entries.withIndex()) {
            val row = layoutInflater.inflate(R.layout.row_review, rows, false)
            if (pos % 2 == 1) row.setBackgroundColor(getColor(R.color.row_yellow))

            row.findViewById<TextView>(R.id.rowSize).text = entry.displaySize()

            val qty = row.findViewById<EditText>(R.id.rowQty)
            qty.setText(entry.quantity.toString())
            qty.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: Editable?) {
                    val v = s.toString().toIntOrNull()
                    if (v != null && v > 0) {
                        entry.quantity = v
                        ProjectStore.save(this@ReviewActivity, project)
                        updateTotal()
                    }
                }
            })
            // If they leave junk in the box, put the last good value back.
            qty.onFocusChangeListener = View.OnFocusChangeListener { _, hasFocus ->
                if (!hasFocus) {
                    val v = qty.text.toString().toIntOrNull()
                    if (v == null || v <= 0) qty.setText(entry.quantity.toString())
                }
            }

            row.findViewById<Button>(R.id.rowDelete).setOnClickListener {
                AlertDialog.Builder(this)
                    .setTitle("Delete size?")
                    .setMessage("Delete ${entry.displaySize()} from the list?")
                    .setPositiveButton("Delete") { _, _ ->
                        project.entries.removeAt(pos)
                        ProjectStore.save(this, project)
                        render()
                    }
                    .setNegativeButton("Cancel", null)
                    .show()
            }
            rows.addView(row)
        }
        updateTotal()
    }

    private fun updateTotal() {
        totalView.text = "Total: ${project.entries.sumOf { it.quantity }} pairs"
    }

    private fun onConfirm() {
        if (project.entries.isEmpty()) {
            Toast.makeText(this, "Nothing to confirm — the list is empty", Toast.LENGTH_SHORT).show()
            return
        }
        val total = project.entries.sumOf { it.quantity }
        if (total % 25 != 0) {
            AlertDialog.Builder(this)
                .setTitle("Something's wrong")
                .setMessage(
                    "The total is $total pairs, which isn't divisible by 25. " +
                            "Check your quantities and try again."
                )
                .setPositiveButton("OK", null)
                .show()
            return
        }
        val boxes = total / 25
        AlertDialog.Builder(this)
            .setTitle("Confirm box count")
            .setMessage("$total pairs → $boxes boxes. Is this correct?")
            .setPositiveButton("Yes") { _, _ ->
                project.locked = true
                project.lockedBoxCount = boxes
                ProjectStore.save(this, project)
                startActivity(
                    Intent(this, LockedActivity::class.java)
                        .putExtra("projectFile", project.fileName)
                )
                finish()
            }
            .setNegativeButton("No", null)
            .show()
    }
}
