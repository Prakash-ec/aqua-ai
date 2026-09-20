with open('D:/aqua-ai/frontend/index.html', 'r') as f:
    content = f.read()

# Find the start - use the section tag
start_marker = '<section\n                    class="page-section"\n                    id="page-analysis"\n                    data-page-section="analysis"\n                >'
start = content.find(start_marker)
print('Start:', start)

# Find the end - the closing section before TRENDS PAGE
end_marker = '</section>\n\n                <!-- =========================================\n                     TRENDS PAGE'
end = content.find(end_marker)
print('End:', end)

if start != -1 and end != -1:
    print('Found both')
    print(content[start:start+100])
    print('---')
    print(content[end-50:end+100])
else:
    # Try alternative end marker
    end_marker2 = '</section>\n\n                <!-- =========================================\n                     TRENDS PAGE'
    end2 = content.find(end_marker2)
    print('End2:', end2)
    
    # Just find the section end after start
    section_end = content.find('</section>', start)
    print('First </section> after start:', section_end)
    # Find the next one
    section_end2 = content.find('</section>', section_end + 1)
    print('Second </section> after start:', section_end2)
    section_end3 = content.find('</section>', section_end2 + 1)
    print('Third </section> after start:', section_end3)