import { NvimPlugin } from 'neovim';
import * as fs from 'fs';
import * as path from 'path';

export class FilePreviewModal {
  private plugin: NvimPlugin;
  private files: Array<{id: number, filepath: string, similarity?: number}>;
  
  constructor(plugin: NvimPlugin, files: Array<{id: number, filepath: string, similarity?: number}>) {
    this.plugin = plugin;
    this.files = files;
  }
  
  async show() {
    const nvim = this.plugin.nvim;
    
    try {
      // Get UI dimensions
      const uiWidth = await nvim.call('winwidth', [0]) as number;
      const uiHeight = await nvim.call('winheight', [0]) as number;
      
      // Create listing content
      const cwd = (await nvim.call('getcwd')) as string;
      const lines = this.files.map((file, index) => {
        let displayPath = file.filepath
        if(file.filepath.startsWith(cwd)){
          displayPath = file.filepath.substring(cwd.length)
        }
        const similarity = file.similarity ? ` [${file.similarity.toFixed(3)}]` : '';
        return `${String(index + 1).padStart(3)}. ${displayPath}${similarity}`;
      });
      
      const header = [
        'Semantic Search Results',
        '═'.repeat(40),
        '',
      ];
      
      const footer = [
        '',
        '─'.repeat(40),
        'Enter: Open file | q: Quit | ↑↓: Navigate'
      ];
      
      const content = [...header, ...lines, ...footer];
      
      // Create buffers
      const listBuffer = await nvim.createBuffer(false, true);
      const previewBuffer = await nvim.createBuffer(false, true);
      
      if(typeof listBuffer === 'number' || typeof previewBuffer === 'number') return;
      
      // Calculate layout
      const totalWidth = Math.floor(uiWidth * 0.8);
      const totalHeight = Math.floor(uiHeight * 0.7);
      const listWidth = Math.floor(totalWidth * 0.4);
      const previewWidth = totalWidth - listWidth;
      
      const row = Math.floor((uiHeight - totalHeight) / 2);
      const col = Math.floor((uiWidth - totalWidth) / 2);
      
      // Create windows
      const listWin = await nvim.openWindow(listBuffer, true, {
        relative: 'editor',
        width: listWidth,
        height: totalHeight,
        row: row,
        col: col,
        border: 'rounded'
      });
      
      const previewWin = await nvim.openWindow(previewBuffer, false, {
        relative: 'editor',
        width: previewWidth,
        height: totalHeight,
        row: row,
        col: col + listWidth,
        border: 'rounded'
      });
      
      if(typeof listWin === 'number' || typeof previewWin === 'number') return;
      
      await listBuffer.setLines(content, { start: 0, end: -1, strictIndexing: false });
      await listBuffer.setOption('modifiable', false);
      await listBuffer.setOption('buftype', 'nofile');
      await listBuffer.setOption('bufhidden', 'wipe');
      
      await previewBuffer.setOption('buftype', 'nofile');
      await previewBuffer.setOption('bufhidden', 'wipe');
      
      // Position cursor on first file entry
      listWin.cursor = [4, 0];
      
      // Show initial preview with the first file
      if (this.files.length > 0) {
        await this.updatePreview(previewBuffer, this.files[0].filepath);
      }
      
      // Create Lua module for our functions
      await nvim.lua(`
        -- Initialize global table
        _G.semantic_search_modal = {}
        
        -- Store files with proper 1-based indexing for Lua
        _G.semantic_search_modal.files = {}
        ${this.files.map((file, i) => 
          `_G.semantic_search_modal.files[${i+1}] = {filepath = "${file.filepath.replace(/\\/g, "\\\\")}"}`
        ).join("\n")}
        
        -- Function to open the selected file
        function _G.semantic_search_modal.open_file()
          local cursor = vim.api.nvim_win_get_cursor(0)
          local line = cursor[1]
          
          if line > 3 and line <= ${lines.length + 3} then
            local file_index = line - 3
            local file = _G.semantic_search_modal.files[file_index]
            
            if file then
              -- Clean up the floating windows
              vim.api.nvim_buf_delete(${listBuffer.id}, {force = true})
              vim.api.nvim_buf_delete(${previewBuffer.id}, {force = true})
              
              -- Open the selected file
              vim.cmd('edit ' .. vim.fn.fnameescape(file.filepath))
            end
          end
        end
        
        -- Function to close the modal windows
        function _G.semantic_search_modal.close_window()
          vim.api.nvim_buf_delete(${listBuffer.id}, {force = true})
          vim.api.nvim_buf_delete(${previewBuffer.id}, {force = true})
        end
        
        -- Function to update the preview window
        function _G.semantic_search_modal.update_preview()
          local cursor = vim.api.nvim_win_get_cursor(0)
          local line = cursor[1]
          
          if line > 3 and line <= ${lines.length + 3} then
            local file_index = line - 3
            local file = _G.semantic_search_modal.files[file_index]
            
            if file then
              local filepath = file.filepath
              
              -- Read file content with proper error handling
              local ok, content = pcall(function()
                local f = io.open(filepath, "r")
                if not f then return nil end
                local data = f:read("*all")
                f:close()
                return data
              end)
              
              if ok and content then
                -- Split content into lines (max 50)
                local lines = {}
                for line in string.gmatch(content, "[^\\r\\n]+") do
                  table.insert(lines, line)
                  if #lines >= 50 then break end
                end
                
                -- Update preview buffer
                vim.api.nvim_buf_set_option(${previewBuffer.id}, 'modifiable', true)
                vim.api.nvim_buf_set_lines(${previewBuffer.id}, 0, -1, false, lines)
                
                -- Set syntax highlighting based on file extension
                local ext = string.match(filepath, "%.([^%.]+)$")
                local ft_map = {
                  js = 'javascript',
                  ts = 'typescript',
                  py = 'python',
                  html = 'html',
                  css = 'css',
                  json = 'json',
                  md = 'markdown',
                  lua = 'lua',
                  vim = 'vim'
                }
                
                if ext and ft_map[ext] then
                  vim.api.nvim_buf_set_option(${previewBuffer.id}, 'filetype', ft_map[ext])
                end
                
                vim.api.nvim_buf_set_option(${previewBuffer.id}, 'modifiable', false)
              else
                -- Error reading the file
                vim.api.nvim_buf_set_option(${previewBuffer.id}, 'modifiable', true)
                vim.api.nvim_buf_set_lines(${previewBuffer.id}, 0, -1, false, {'File not found or could not be read'})
                vim.api.nvim_buf_set_option(${previewBuffer.id}, 'modifiable', false)
              end
            end
          end
        end
        
        -- Debug function to check if our Lua setup is working
        function _G.semantic_search_modal.test()
          print("Lua module is working correctly")
        end
      `);
      
      await nvim.command(`
        call nvim_buf_set_keymap(${listBuffer.id}, 'n', '<CR>', ':lua _G.semantic_search_modal.open_file()<CR>', {'noremap': v:true, 'silent': v:true})
        call nvim_buf_set_keymap(${listBuffer.id}, 'n', 'q', ':lua _G.semantic_search_modal.close_window()<CR>', {'noremap': v:true, 'silent': v:true})
      `);
      
      await nvim.command(`
        augroup SemanticSearchModal
          autocmd!
          autocmd CursorMoved <buffer=${listBuffer.id}> lua _G.semantic_search_modal.update_preview()
        augroup END
      `);
      
      // Manually trigger the initial preview update
      await nvim.command('lua _G.semantic_search_modal.update_preview()');
      
    } catch (error) {
      console.error('Failed to show modal:', error);
      await nvim.outWrite(`Error: ${error}\n`);
    }
  }
  
  private async updatePreview(buffer: any, filepath: string | undefined) {
    if (!filepath) return;
    
    try {
      let content: string[] = [];
      if (fs.existsSync(filepath)) {
        const fileContent = fs.readFileSync(filepath, 'utf8');
        content = fileContent.split('\n').slice(0, 50);
        
        const ext = path.extname(filepath).slice(1);
        const ftMap: {[key: string]: string} = {
          'js': 'javascript',
          'ts': 'typescript',
          'py': 'python',
          'html': 'html',
          'css': 'css',
          'json': 'json',
          'md': 'markdown',
          'lua': 'lua',
          'vim': 'vim'
        };
        
        if (ext && ftMap[ext]) {
          await buffer.setOption('filetype', ftMap[ext]);
        }
      } else {
        content = ['File not found'];
      }
      
      await buffer.setOption('modifiable', true);
      await buffer.setLines(content, { start: 0, end: -1, strictIndexing: false });
      await buffer.setOption('modifiable', false);
    } catch (error) {
      await buffer.setOption('modifiable', true);
      await buffer.setLines(['Error reading file'], { start: 0, end: -1, strictIndexing: false });
      await buffer.setOption('modifiable', false);
    }
  }
}


